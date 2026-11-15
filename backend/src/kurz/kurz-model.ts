import { Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import type { ModelUsage } from '../ai/ai-cost';
import type { KurzSource } from './kurz-sources';

/** One call to the model: everything it needs, nothing it should not have. */
export interface KurzModelRequest {
  model: string;
  system: string;
  input: string;
  schema: object;
  thinkingLevel: string;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Only the fake model reads these, to build an answer that quotes the post. The real one ignores them. */
  sources: KurzSource[];
  question: string;
}

export type KurzModelResult =
  | {
      /** `incomplete`: cut off at `maxOutputTokens`. It is billed, and its text is not trusted. */
      status: 'completed' | 'incomplete';
      text: string | null;
      usage: ModelUsage;
      /** The `usage` object as the API sent it, kept in `ai_usage` to recompute a wrong formula. */
      raw: unknown;
    }
  /** The provider refused the text (safety, jailbreak filter...). Nothing was billed. */
  | { status: 'blocked'; code: string };

/** The provider failed (down, slow, bad request). Carries no text of the conversation, so it is safe to log. */
export class KurzUpstreamError extends Error {
  constructor(
    readonly httpStatus: number | null,
    readonly timedOut = false,
  ) {
    super(
      `model call failed (${timedOut ? 'timeout' : (httpStatus ?? 'network')})`,
    );
  }
}

export abstract class KurzModel {
  /** False when there is nothing to ask (no API key): the Kurz then reports itself as off. */
  abstract available(): boolean;
  abstract ask(request: KurzModelRequest): Promise<KurzModelResult>;
}

/** What the Kurz runs on when `GOOGLE_GEMINI_API_KEY` is not set: it is off, and says so. */
export class UnconfiguredKurzModel extends KurzModel {
  available(): boolean {
    return false;
  }

  ask(): Promise<KurzModelResult> {
    return Promise.reject(new KurzUpstreamError(null));
  }
}

/** HTTP 400 codes the API uses when it refuses the content itself (docs: safety-settings). */
const BLOCK_CODES = new Set([
  'safety',
  'jailbreak',
  'prohibited_content',
  'blocklist',
]);

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;

/** `usage` of an interaction -> the four numbers the bill is made of. */
export function usageOf(usage: unknown): ModelUsage {
  const u = (usage ?? {}) as Record<string, unknown>;
  return {
    input: num(u.total_input_tokens),
    cached: num(u.total_cached_tokens),
    output: num(u.total_output_tokens),
    thought: num(u.total_thought_tokens),
  };
}

interface OutputStep {
  type?: unknown;
  content?: { type?: unknown; text?: unknown }[];
}

/** The text of the answer: what the `model_output` steps carry in their text content. */
export function textOf(steps: unknown): string | null {
  const parts: string[] = [];
  for (const step of Array.isArray(steps) ? (steps as OutputStep[]) : []) {
    if (step?.type !== 'model_output') continue;
    for (const content of Array.isArray(step.content) ? step.content : [])
      if (content?.type === 'text' && typeof content.text === 'string')
        parts.push(content.text);
  }
  return parts.length > 0 ? parts.join('') : null;
}

/** What an SDK or HTTP error says, read for its status and its `code`, never for its text. */
function describe(error: unknown): {
  status: number | null;
  code: string | null;
  timedOut: boolean;
} {
  const e = error as {
    status?: unknown;
    statusCode?: unknown;
    name?: unknown;
    code?: unknown;
    body?: unknown;
    message?: unknown;
  };
  const status = [e?.status, e?.statusCode].find(
    (v): v is number => typeof v === 'number',
  );
  let code: string | null = typeof e?.code === 'string' ? e.code : null;
  const body =
    typeof e?.body === 'string'
      ? e.body
      : typeof e?.message === 'string'
        ? e.message
        : '';
  if (!code) {
    const found =
      /"code"\s*:\s*"([a-z_]+)"/.exec(body) ??
      /"type"\s*:\s*"([a-z_]+)"/.exec(body);
    code = found?.[1] ?? null;
  }
  const name = typeof e?.name === 'string' ? e.name : '';
  const timedOut =
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /timed? ?out|abort/i.test(name);
  return { status: status ?? null, code, timedOut };
}

/** The Gemini Interactions API through the official SDK: one call, no tools, nothing stored on Google's side. */
export class GeminiKurzModel extends KurzModel {
  private readonly log = new Logger('Kurz');
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    super();
    this.client = new GoogleGenAI({ apiKey });
  }

  available(): boolean {
    return true;
  }

  async ask(request: KurzModelRequest): Promise<KurzModelResult> {
    try {
      const interaction = await this.client.interactions.create(
        {
          model: request.model,
          input: request.input,
          system_instruction: request.system,
          // The conversation is ours: Google keeps nothing (the default would keep it 55 days).
          store: false,
          generation_config: {
            thinking_level: request.thinkingLevel as never,
            max_output_tokens: request.maxOutputTokens,
          },
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: request.schema,
          },
          // One response, untouched: a continuation hop would be one more billed call.
          automatic_continuation: false,
        },
        { timeout_ms: request.timeoutMs, maxRetries: 0 },
      );
      const body = interaction as unknown as {
        status?: string;
        steps?: unknown;
        usage?: unknown;
      };
      if (body.status !== 'completed' && body.status !== 'incomplete')
        throw new KurzUpstreamError(null);
      return {
        status: body.status,
        text: textOf(body.steps),
        usage: usageOf(body.usage),
        raw: body.usage ?? null,
      };
    } catch (error) {
      if (error instanceof KurzUpstreamError) throw error;
      const { status, code, timedOut } = describe(error);
      if (status === 400 && code && BLOCK_CODES.has(code))
        return { status: 'blocked', code };
      this.log.warn(
        `model call failed status=${status ?? 'none'} code=${code ?? 'none'} timeout=${timedOut}`,
      );
      throw new KurzUpstreamError(status, timedOut);
    }
  }
}
