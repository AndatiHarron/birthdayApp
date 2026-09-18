import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import type { PutObjectInput, StorageProvider, StoredObject } from './types';

/**
 * Local-disk storage for development and tests.
 *
 * Objects are served back by the API's `/uploads` static mount. Not suitable
 * for production behind more than one instance — the files would only exist on
 * whichever box handled the upload — hence the S3 driver.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';
  private readonly root: string;
  private readonly baseUrl: string;

  constructor() {
    this.root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);
    this.baseUrl = (env.STORAGE_PUBLIC_BASE_URL ?? `${env.API_BASE_URL}/uploads`).replace(/\/$/, '');
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = buildKey(input.folder, input.filename);
    const target = this.resolveSafe(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
    return {
      key,
      url: this.publicUrl(key),
      contentType: input.contentType,
      size: input.body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveSafe(key), { force: true });
  }

  async signedUrl(key: string): Promise<string> {
    // Nothing to sign on local disk; the mount is already reachable.
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Refuses keys that would escape the storage root. Keys are generated
   * server-side, but a traversal bug here would be an arbitrary-file-write, so
   * the check is worth having regardless.
   */
  private resolveSafe(key: string): string {
    const target = path.resolve(this.root, key);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (!target.startsWith(rootWithSep)) {
      throw new AppError('UPLOAD_FAILED', { context: { key } });
    }
    return target;
  }
}

/**
 * `folder/2026/09/<uuid>-<hash>.<ext>`
 *
 * The date prefix keeps directories from growing unbounded, and the random
 * component means an object key cannot be guessed from the original filename.
 */
export function buildKey(folder: string, filename: string): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
  const digest = createHash('sha1').update(filename).digest('hex').slice(0, 8);
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, '');
  return `${safeFolder}/${year}/${month}/${randomUUID()}-${digest}${ext}`;
}
