import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { StorageConfig } from './storage.config';

export interface ObjectStream {
  body: Readable;
  size: number;
  contentType?: string;
}

export interface StoredObject {
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

const DEFAULT_EXPIRES_IN = 300;
const MAX_EXPIRES_IN = 3600;

/**
 * Private object storage over the S3 protocol (SeaweedFS today). Callers only deal in object keys,
 * bytes and content types; nothing from the AWS SDK leaks through the method signatures.
 */
export class StorageService implements OnModuleDestroy {
  private readonly client: S3Client;
  // Signing is local (no network), so a separate client can sign for the host browsers use.
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    const base = {
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      // The SDK's default CRC32 trailer is not understood by every S3-compatible server.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.bucket = config.bucket;
    this.client = new S3Client({ ...base, endpoint: config.endpoint });
    this.signer = config.publicEndpoint
      ? new S3Client({ ...base, endpoint: config.publicEndpoint })
      : this.client;
  }

  /** An opaque key; never build one from a user-provided filename. */
  newKey(prefix: string): string {
    return `${prefix}/${randomUUID()}`;
  }

  async put(
    key: string,
    body: Buffer | Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * Metadata of the object, or null when it does not exist. HEAD has no body, so a missing bucket
   * also reads as null; the first put into it is what fails loudly.
   */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
        etag: res.ETag,
        lastModified: res.LastModified,
      };
    } catch (err) {
      if (err instanceof NotFound) return null;
      throw err;
    }
  }

  /** The object as a stream, or null when it does not exist. The caller must consume or destroy the body. */
  async getStream(key: string): Promise<ObjectStream | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        body: res.Body as Readable,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType,
      };
    } catch (err) {
      if (err instanceof NoSuchKey) return null;
      throw err;
    }
  }

  async presignGet(
    key: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: checkExpiry(expiresIn) },
    );
  }

  /** Content-Type is part of the signature: the upload must send exactly this one. */
  async presignPut(
    key: string,
    contentType: string,
    expiresIn = DEFAULT_EXPIRES_IN,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
      {
        expiresIn: checkExpiry(expiresIn),
        // The presigner only signs `host` by default, which would let the client pick any type.
        signableHeaders: new Set(['content-type']),
      },
    );
  }

  onModuleDestroy() {
    this.client.destroy();
    this.signer.destroy();
  }
}

function checkExpiry(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_EXPIRES_IN) {
    throw new RangeError(
      `Presigned URL expiry must be 1 to ${MAX_EXPIRES_IN} seconds`,
    );
  }
  return seconds;
}
