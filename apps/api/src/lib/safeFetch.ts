import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError } from './errors';

/**
 * Outbound HTTP for user-supplied URLs (wishlist link previews).
 *
 * Fetching a URL a user typed is a server-side request forgery risk: without
 * care, `http://169.254.169.254/` or `http://localhost:5432/` would be fetched
 * from inside our network. The guard is applied in the socket's DNS `lookup`
 * hook, i.e. to the address actually being connected to, which also defeats
 * DNS-rebinding tricks where a hostname resolves publicly once and privately
 * the next time. Redirects are followed manually so every hop is re-checked.
 */

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = 0, b = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
    if (/^fe[89ab]/.test(lower)) return true; // link-local
    if (lower.startsWith('ff')) return true; // multicast
    return false;
  }
  return true;
}

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, '');
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((entry) => isPrivateAddress(entry.address));
    if (blocked || list.length === 0) {
      const refusal = new Error('Refusing to connect to a private address') as NodeJS.ErrnoException;
      refusal.code = 'EPRIVATE';
      return callback(refusal, '');
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    return callback(null, first.address, first.family);
  });
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

export async function safeFetchText(
  rawUrl: string,
  options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 6000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  let redirectsLeft = options.maxRedirects ?? 4;
  let current = rawUrl;

  for (;;) {
    const url = new URL(current);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AppError('URL_UNFURL_FAILED');
    if (url.username || url.password) throw new AppError('URL_UNFURL_FAILED');
    if (url.port && url.port !== '80' && url.port !== '443') throw new AppError('URL_UNFURL_FAILED');
    if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
      throw new AppError('URL_UNFURL_FAILED');
    }

    const response = await requestOnce(url, timeoutMs, maxBytes);
    if (response.status >= 300 && response.status < 400 && response.location) {
      if (redirectsLeft <= 0) throw new AppError('URL_UNFURL_FAILED');
      redirectsLeft -= 1;
      current = new URL(response.location, url).toString();
      continue;
    }
    return { finalUrl: url.toString(), status: response.status, contentType: response.contentType, body: response.body };
  }
}

function requestOnce(
  url: URL,
  timeoutMs: number,
  maxBytes: number,
): Promise<{ status: number; contentType: string; location: string | null; body: string }> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: 'GET',
        lookup: guardedLookup as never,
        timeout: timeoutMs,
        headers: {
          // Many shops serve a stripped page to unknown bots; a browser-like
          // agent gets the Open Graph tags we need.
          'user-agent': 'Mozilla/5.0 (compatible; BirthdayAppBot/1.0; +https://birthday.app/bot)',
          accept: 'text/html,application/xhtml+xml',
          'accept-encoding': 'identity',
          'accept-language': 'en',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === 'string' ? response.headers.location : null;
        const contentType = String(response.headers['content-type'] ?? '');
        if (status >= 300 && status < 400) {
          response.resume();
          resolve({ status, contentType, location, body: '' });
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > maxBytes) {
            // Enough of the <head> has arrived by now; stop reading.
            response.destroy();
            resolve({ status, contentType, location, body: Buffer.concat(chunks).toString('utf8') });
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status, contentType, location, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', (error) => reject(new AppError('URL_UNFURL_FAILED', { cause: error })));
    request.end();
  });
}
