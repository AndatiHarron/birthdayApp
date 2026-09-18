import { ERROR_STATUS, ErrorCode } from '@bday/shared';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '../config/env';
import { routeRegistry, type RegisteredRoute } from '../http/route';
import '../routes';

/**
 * OpenAPI 3.1 document built from the route registry (spec §62.20).
 *
 * Request schemas come straight from the Zod validators each route runs, so
 * the documented contract is exactly the enforced one. Response bodies share
 * the standard envelope; their `data` types are the DTOs in `@bday/shared`.
 */

// The library's generic signature is expensive for the compiler to instantiate
// against our schemas; a plain function type keeps typechecking fast.
const convert = zodToJsonSchema as unknown as (schema: unknown, options: Record<string, unknown>) => Record<string, unknown>;

function toSchema(schema: ZodTypeAny, io: 'input' | 'output' = 'input') {
  const json = convert(schema, { target: 'openApi3', $refStrategy: 'none', effectStrategy: io });
  delete json.$schema;
  return json;
}

function parameters(route: RegisteredRoute) {
  const params: Array<Record<string, unknown>> = [];
  const pathNames = [...route.path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]!);

  const pathSchema = route.definition.params ? (toSchema(route.definition.params) as { properties?: Record<string, unknown> }) : null;
  for (const name of pathNames) {
    params.push({ name, in: 'path', required: true, schema: pathSchema?.properties?.[name] ?? { type: 'string' } });
  }

  if (route.definition.query) {
    const querySchema = toSchema(route.definition.query) as { properties?: Record<string, unknown>; required?: string[] };
    for (const [name, schema] of Object.entries(querySchema.properties ?? {})) {
      params.push({ name, in: 'query', required: querySchema.required?.includes(name) ?? false, schema });
    }
  }
  return params;
}

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routeRegistry) {
    const path = `/api/v1${route.path.replace(/:([A-Za-z]+)/g, '{$1}')}`;
    const definition = route.definition;
    const secured = definition.auth !== 'public';

    const operation: Record<string, unknown> = {
      tags: [route.tag],
      summary: definition.summary,
      ...(definition.description ? { description: definition.description } : {}),
      operationId: `${route.method}${route.path.replace(/[/:{}.-]+(\w)?/g, (_, char: string | undefined) => (char ? char.toUpperCase() : ''))}`,
      parameters: parameters(route),
      ...(secured ? { security: definition.auth === 'optional' ? [{ bearerAuth: [] }, {}] : [{ bearerAuth: [] }] } : {}),
      responses: {
        [String(definition.status ?? 200)]:
          definition.status === 204
            ? { description: 'No content' }
            : definition.raw
              ? { description: 'File download' }
              : { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/SuccessEnvelope' } } } },
        default: { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } } },
      },
    };

    if (definition.body) {
      const multipart = definition.middleware?.some((handler) => handler.name === 'multerMiddleware');
      operation.requestBody = {
        required: true,
        content: { 'application/json': { schema: toSchema(definition.body) } },
      };
      if (multipart) {
        operation.requestBody = {
          required: true,
          content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } },
        };
      }
    } else if (route.path.startsWith('/uploads')) {
      operation.requestBody = {
        required: true,
        content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } },
      };
    }

    paths[path] ??= {};
    paths[path]![route.method] = operation;
  }

  paths['/api/v1/webhooks/payments/{provider}'] = {
    post: {
      tags: ['Payments'],
      summary: 'Payment provider webhook (signature verified, raw body)',
      parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string', enum: ['mpesa', 'stripe', 'sandbox'] } }],
      requestBody: { required: true, content: { '*/*': { schema: {} } } },
      responses: { '200': { description: 'Acknowledged' } },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Birthday Gifting API',
      version: '1.0.0',
      description:
        'REST API for the birthday gifting platform. All responses use the envelope `{ success, data }` or `{ success: false, code, message, errors? }`. Money is always an integer number of minor units with a currency code. Realtime events are delivered over Socket.IO at path `/realtime`.',
    },
    servers: [{ url: env.API_BASE_URL }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        SuccessEnvelope: {
          type: 'object',
          required: ['success', 'data'],
          properties: { success: { const: true }, data: {}, meta: { type: 'object' } },
        },
        ErrorEnvelope: {
          type: 'object',
          required: ['success', 'code', 'message'],
          properties: {
            success: { const: false },
            code: { type: 'string', enum: Object.values(ErrorCode) },
            message: { type: 'string' },
            errors: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
            requestId: { type: 'string' },
          },
        },
        ErrorStatusTable: {
          description: 'HTTP status used for each error code',
          type: 'object',
          properties: Object.fromEntries(Object.entries(ERROR_STATUS).map(([code, status]) => [code, { const: status }])),
        },
      },
    },
    paths,
  };
}
