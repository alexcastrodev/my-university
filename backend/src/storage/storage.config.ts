export interface StorageConfig {
  endpoint: string;
  // Host the browser can reach, used only to sign presigned URLs. Defaults to `endpoint`.
  publicEndpoint?: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  // SeaweedFS serves buckets as /bucket/key unless a wildcard domain is configured.
  forcePathStyle: boolean;
}

const REQUIRED = [
  'S3_ENDPOINT',
  'S3_BUCKET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
] as const;

/** Reads the S3 settings from the environment and fails with every missing name at once. */
export function loadStorageConfig(
  env: NodeJS.ProcessEnv = process.env,
): StorageConfig {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Missing storage config: ${missing.join(', ')}`);
  }
  return {
    endpoint: env.S3_ENDPOINT!,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT || undefined,
    bucket: env.S3_BUCKET!,
    region: env.S3_REGION || 'us-east-1',
    accessKey: env.S3_ACCESS_KEY!,
    secretKey: env.S3_SECRET_KEY!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
  };
}
