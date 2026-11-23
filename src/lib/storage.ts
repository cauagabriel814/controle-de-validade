import { Client } from 'minio';
import { Readable } from 'node:stream';
import { config } from '../config.js';

export interface StoredFile {
  stream: Readable;
  size: number;
  contentType: string;
}

export interface Storage {
  init(): Promise<void>;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** undefined quando o arquivo não existe. */
  get(key: string): Promise<StoredFile | undefined>;
  remove(key: string): Promise<void>;
}

/** Fotos no MinIO (compatível com S3). O bucket é privado: quem entrega a foto é a API, após checar o login. */
function minioStorage(): Storage {
  const { endPoint, port, useSSL, accessKey, secretKey, bucket } = config.storage;
  const client = new Client({ endPoint, port, useSSL, accessKey, secretKey });

  return {
    async init() {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
    },
    async put(key, data, contentType) {
      await client.putObject(bucket, key, data, data.length, { 'Content-Type': contentType });
    },
    async get(key) {
      try {
        const stat = await client.statObject(bucket, key);
        const stream = await client.getObject(bucket, key);
        return { stream, size: stat.size, contentType: String(stat.metaData['content-type'] ?? 'application/octet-stream') };
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'NotFound' || code === 'NoSuchKey') return undefined;
        throw err;
      }
    },
    async remove(key) {
      await client.removeObject(bucket, key);
    },
  };
}

/** Em memória, para os testes. */
export function memoryStorage(): Storage & { files: Map<string, { data: Buffer; contentType: string }> } {
  const files = new Map<string, { data: Buffer; contentType: string }>();
  return {
    files,
    async init() {},
    async put(key, data, contentType) {
      files.set(key, { data, contentType });
    },
    async get(key) {
      const f = files.get(key);
      return f && { stream: Readable.from(f.data), size: f.data.length, contentType: f.contentType };
    },
    async remove(key) {
      files.delete(key);
    },
  };
}

export const storage: Storage = config.storage.driver === 'memory' ? memoryStorage() : minioStorage();
