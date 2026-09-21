import { promises as fs } from "node:fs";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/server/env";

/**
 * Object storage behind an interface (Section 3). All media is private; the only
 * way out is a short-lived signed URL issued after an authorization check (INV-P6).
 */
export interface StorageAdapter {
  /** Presigned PUT the browser uploads to directly. */
  createUploadUrl(key: string, contentType: string, ttlSeconds?: number): Promise<{ url: string; method: "PUT"; headers: Record<string, string> }>;
  /** Presigned GET, short TTL. */
  createDownloadUrl(key: string, ttlSeconds?: number): Promise<string>;
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export function newStorageKey(prefix: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${safeExt}`;
}

export class S3Storage implements StorageAdapter {
  private client: S3Client;
  constructor(private bucket: string, opts: { endpoint?: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      forcePathStyle: opts.forcePathStyle,
    });
  }
  async createUploadUrl(key: string, contentType: string, ttlSeconds = getEnv().SIGNED_URL_TTL_SECONDS) {
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: ttlSeconds });
    return { url, method: "PUT" as const, headers: { "Content-Type": contentType } };
  }
  createDownloadUrl(key: string, ttlSeconds = getEnv().SIGNED_URL_TTL_SECONDS) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: ttlSeconds });
  }
  async put(key: string, body: Buffer | Uint8Array, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

/**
 * Local disk storage for development without MinIO. Signed URLs are HMAC tokens
 * validated by the /api/storage route (Phase 1); they expire like S3 URLs.
 */
export class LocalDiskStorage implements StorageAdapter {
  constructor(private dir: string, private appUrl: string, private secret: string) {}

  private abs(key: string) {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir))) throw new Error("Invalid storage key");
    return p;
  }

  sign(key: string, expires: number, method: "GET" | "PUT") {
    return createHmac("sha256", this.secret).update(`${method}:${key}:${expires}`).digest("hex");
  }

  verify(key: string, expires: number, method: "GET" | "PUT", sig: string) {
    return expires > Date.now() && this.sign(key, expires, method) === sig;
  }

  async createUploadUrl(key: string, contentType: string, ttlSeconds = getEnv().SIGNED_URL_TTL_SECONDS) {
    const expires = Date.now() + ttlSeconds * 1000;
    const url = `${this.appUrl}/api/storage/${encodeURIComponent(key)}?exp=${expires}&sig=${this.sign(key, expires, "PUT")}`;
    return { url, method: "PUT" as const, headers: { "Content-Type": contentType } };
  }
  async createDownloadUrl(key: string, ttlSeconds = getEnv().SIGNED_URL_TTL_SECONDS) {
    const expires = Date.now() + ttlSeconds * 1000;
    return `${this.appUrl}/api/storage/${encodeURIComponent(key)}?exp=${expires}&sig=${this.sign(key, expires, "GET")}`;
  }
  async put(key: string, body: Buffer | Uint8Array) {
    const p = this.abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
  }
  async exists(key: string) {
    try {
      await fs.access(this.abs(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await fs.rm(this.abs(key), { force: true });
  }
}

let instance: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (instance) return instance;
  const env = getEnv();
  if (env.STORAGE_DRIVER === "s3") {
    instance = new S3Storage(env.S3_BUCKET!, {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  } else {
    instance = new LocalDiskStorage(env.STORAGE_LOCAL_DIR, env.APP_URL, process.env.STORAGE_SECRET ?? "dev-storage-secret");
  }
  return instance;
}
