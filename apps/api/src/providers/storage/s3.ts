import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { buildKey } from './local';
import type { PutObjectInput, StorageProvider, StoredObject } from './types';

/**
 * S3-compatible object storage. Works unchanged against AWS S3, Cloudflare R2,
 * DigitalOcean Spaces and MinIO — only the endpoint and path-style flag differ.
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string | null;

  constructor() {
    if (!env.S3_BUCKET) {
      throw new Error('S3_BUCKET must be set when STORAGE_DRIVER=s3');
    }
    this.bucket = env.S3_BUCKET;
    this.publicBase = env.STORAGE_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? null;
    this.client = new S3Client({
      region: env.S3_REGION ?? 'us-east-1',
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const key = buildKey(input.folder, input.filename);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: input.body,
          ContentType: input.contentType,
          // Long cache lifetime is safe: keys contain a random component, so
          // content at a given key never changes.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch (error) {
      logger.error({ err: error, key }, 's3 upload failed');
      throw new AppError('UPLOAD_FAILED', { cause: error });
    }
    return {
      key,
      url: this.publicUrl(key),
      contentType: input.contentType,
      size: input.body.byteLength,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      // A failed delete leaves an orphan object, which is a cost problem rather
      // than a correctness one — log it and let the caller proceed.
      logger.warn({ err: error, key }, 's3 delete failed');
    }
  }

  async signedUrl(key: string, expiresInSeconds = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  publicUrl(key: string): string {
    if (this.publicBase) return `${this.publicBase}/${key}`;
    if (env.S3_ENDPOINT) {
      const base = env.S3_ENDPOINT.replace(/\/$/, '');
      return env.S3_FORCE_PATH_STYLE ? `${base}/${this.bucket}/${key}` : `${base}/${key}`;
    }
    return `https://${this.bucket}.s3.${env.S3_REGION ?? 'us-east-1'}.amazonaws.com/${key}`;
  }
}
