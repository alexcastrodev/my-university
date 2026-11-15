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
 * not in the request body, not in a breadcrumb, not in extra data. An event from a `/api/kurz` request keeps its
 * route, status, stack and timing, and loses the rest. (The server code logs only ids, sizes and token counts.)
 */
export function scrubKurz<T extends ScrubbableEvent>(event: T): T {
  if (!event.request?.url?.includes('/api/kurz')) return event;
  return {
    ...event,
    request: { url: event.request.url },
    breadcrumbs: [],
    extra: undefined,
  };
}
