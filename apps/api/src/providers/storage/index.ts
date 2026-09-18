import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { LocalStorageProvider } from './local';
import { S3StorageProvider } from './s3';
import { UPLOAD_KINDS, type StorageProvider, type StoredObject, type UploadKind } from './types';

let provider: StorageProvider | null = null;

export function storage(): StorageProvider {
  if (!provider) {
    provider = env.STORAGE_DRIVER === 's3' ? new S3StorageProvider() : new LocalStorageProvider();
    logger.info({ driver: provider.name }, 'storage provider ready');
  }
  return provider;
}

/**
 * Magic-byte signatures.
 *
 * A client-supplied `Content-Type` is a hint, not evidence. Checking the actual
 * bytes is what stops an HTML or SVG file with a `image/png` header being
 * stored and later served back from our own origin as a stored-XSS payload.
 */
const SIGNATURES: Array<{ mime: string; test: (buffer: Buffer) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/gif',
    test: (b) => b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a',
  },
  {
    mime: 'image/webp',
    test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    // MP4 / M4A / MOV all use the ISO base media container.
    mime: 'video/mp4',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  { mime: 'audio/mpeg', test: (b) => (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) || b.subarray(0, 3).toString('ascii') === 'ID3' },
  { mime: 'audio/wav', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE' },
  { mime: 'audio/webm', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
];

function detectMime(buffer: Buffer): string | null {
  if (buffer.byteLength < 12) return null;
  for (const signature of SIGNATURES) {
    if (signature.test(buffer)) return signature.mime;
  }
  return null;
}

/** ISO-container formats share a signature; treat them as interchangeable. */
const MIME_FAMILIES: Record<string, string[]> = {
  'video/mp4': ['video/mp4', 'video/quicktime', 'audio/mp4', 'audio/m4a', 'audio/aac'],
  'audio/mpeg': ['audio/mpeg'],
  'audio/webm': ['audio/webm', 'video/webm'],
};

function isAcceptable(detected: string, declared: string, allowed: readonly string[]): boolean {
  const family = MIME_FAMILIES[detected] ?? [detected];
  return family.some((mime) => allowed.includes(mime)) && family.includes(declared);
}

/**
 * Validates and stores an upload.
 *
 * Every check that matters happens here rather than in the route: size cap,
 * declared type against the kind's allow-list, and declared type against the
 * bytes on disk.
 */
export async function storeUpload(
  kind: UploadKind,
  file: { buffer: Buffer; mimetype: string; originalname: string },
): Promise<StoredObject> {
  const spec = UPLOAD_KINDS[kind];
  if (!spec) throw new AppError('VALIDATION_ERROR', { message: 'Unknown upload type.' });

  if (file.buffer.byteLength === 0) {
    throw new AppError('VALIDATION_ERROR', { message: 'That file is empty.' });
  }
  if (file.buffer.byteLength > spec.maxBytes) {
    throw new AppError('PAYLOAD_TOO_LARGE', {
      message: `Files must be under ${Math.round(spec.maxBytes / (1024 * 1024))} MB.`,
    });
  }

  const declared = file.mimetype.toLowerCase().split(';')[0]!.trim();
  if (!(spec.types as readonly string[]).includes(declared)) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED', {
      message: `Allowed types: ${spec.types.join(', ')}.`,
    });
  }

  const detected = detectMime(file.buffer);
  if (!detected || !isAcceptable(detected, declared, spec.types)) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED', {
      message: 'That file does not look like the type it claims to be.',
      context: { declared, detected },
    });
  }

  return storage().put({
    folder: spec.folder,
    filename: file.originalname || 'upload',
    contentType: declared,
    body: file.buffer,
  });
}

export { UPLOAD_KINDS };
export type { StorageProvider, StoredObject, UploadKind };
