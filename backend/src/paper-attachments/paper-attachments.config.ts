export interface AttachmentLimits {
  /** Largest PDF accepted, in bytes. The nginx `client_max_body_size` for the upload route must not be lower. */
  maxBytes: number;
  /** Most bytes of PDFs one reader may keep (waiting for a scan or approved). */
  quotaBytes: number;
}

const MIB = 1024 * 1024;

function bytesFrom(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Read when the app starts, so a limit changes with a restart and a test can set it before building the app. */
export function loadAttachmentLimits(
  env: NodeJS.ProcessEnv = process.env,
): AttachmentLimits {
  return {
    maxBytes: bytesFrom(env.PAPER_PDF_MAX_BYTES, 25 * MIB),
    quotaBytes: bytesFrom(env.PAPER_PDF_USER_QUOTA_BYTES, 500 * MIB),
  };
}
