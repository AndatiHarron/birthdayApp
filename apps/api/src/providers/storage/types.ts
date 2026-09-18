export interface StoredObject {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

export interface PutObjectInput {
  /** Logical folder, e.g. `avatars`, `wishlist`, `cards`, `voice`. */
  folder: string;
  filename: string;
  contentType: string;
  body: Buffer;
  /** Public objects get a stable URL; private ones need a signed URL to read. */
  visibility?: 'public' | 'private';
}

/**
 * Object storage contract (spec §62.12).
 *
 * Implemented by the local-disk driver for development and by S3 (or any
 * S3-compatible service — MinIO, R2, Spaces) for production. Nothing outside
 * this folder knows which one is active.
 */
export interface StorageProvider {
  readonly name: string;
  put(input: PutObjectInput): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Time-limited read URL for private objects. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  /** Public URL for an object stored with `visibility: 'public'`. */
  publicUrl(key: string): string;
}

/** Upload categories, each with its own size cap and accepted media types. */
export const UPLOAD_KINDS = {
  avatar: { folder: 'avatars', maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  wishlist: { folder: 'wishlist', maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  card: { folder: 'cards', maxBytes: 8 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] },
  sticker: { folder: 'stickers', maxBytes: 2 * 1024 * 1024, types: ['image/png', 'image/webp', 'image/gif'] },
  memory: {
    folder: 'memories',
    maxBytes: 64 * 1024 * 1024,
    types: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'],
  },
  voice: {
    folder: 'voice',
    maxBytes: 16 * 1024 * 1024,
    types: ['audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/webm', 'audio/m4a'],
  },
  chat: {
    folder: 'chat',
    maxBytes: 32 * 1024 * 1024,
    types: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'audio/mp4',
      'audio/mpeg',
      'audio/aac',
      'audio/webm',
    ],
  },
  product: {
    folder: 'products',
    maxBytes: 8 * 1024 * 1024,
    types: ['image/jpeg', 'image/png', 'image/webp'],
  },
} as const;

export type UploadKind = keyof typeof UPLOAD_KINDS;
