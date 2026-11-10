import { isPaperSlug } from '../papers/paper-ref';

/**
 * A paper is a discussion topic like a concept is, but it is not concept content: its identity is the paper's
 * slug (`paper:<slug>`), it has no sections to quote, and its page is /papers/<slug>. Only the board at the
 * end of the page applies to it, so there are no paragraph threads for papers. Only public papers have one.
 */
export const PAPERS_MODULE = 'papers';
export const PAPER_TOPIC_PREFIX = 'paper:';

/** The slug of the paper a topic key points at, or null when the key belongs to a concept. */
export function paperSlugOfTopicKey(topicKey: string): string | null {
  if (!topicKey.startsWith(PAPER_TOPIC_PREFIX)) return null;
  const slug = topicKey.slice(PAPER_TOPIC_PREFIX.length);
  return isPaperSlug(slug) ? slug : null;
}
