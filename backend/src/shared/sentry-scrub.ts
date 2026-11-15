/** The part of a Sentry event this looks at, so it needs no dependency on the SDK's own types. */
interface ScrubbableEvent {
  request?: {
    url?: string;
    data?: unknown;
    cookies?: unknown;
    query_string?: unknown;
    headers?: unknown;
  };
  breadcrumbs?: unknown[];
  extra?: unknown;
}

/**
 * What a student writes to the Kurz (the question, the selection) and what it answers must never reach Sentry:
 * not in the request body, not in a breadcrumb, not in extra data. An event from a Kurz request keeps its
 * route, status, stack and timing, and loses the rest. (The server code logs only ids, sizes and token counts.)
 */
/** A Kurz route, with or without the `/api` prefix, whole or relative, in any case: `/api/kurz`, `/kurz/x?y`. */
const KURZ_ROUTE = /(?:^|\/)(?:api\/)?kurz(?:[/?#]|$)/i;

/** The path of a URL, whether the SDK recorded it whole (`https://host/api/kurz`) or relative (`/kurz`). */
function pathOf(url: string): string {
  try {
    return new URL(url, 'http://local').pathname;
  } catch {
    return url;
  }
}

export function scrubKurz<T extends ScrubbableEvent>(event: T): T {
  const url = event.request?.url;
  if (!url || !KURZ_ROUTE.test(pathOf(url))) return event;
  return {
    ...event,
    request: { url },
    breadcrumbs: [],
    extra: undefined,
  };
}
