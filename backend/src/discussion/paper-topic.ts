import { isPublicId } from '../papers/paper-public-id';

/**
 * A paper is a discussion topic like a concept is, but it is not concept content: its identity is the
 * paper's public id (`paper:<publicId>`), it has no sections to quote, and its page is /papers/<publicId>.
 * Only the board at the end of the page applies to it, so there are no paragraph threads for papers.
 */
export const PAPERS_MODULE = 'papers';
export const PAPER_TOPIC_PREFIX = 'paper:';

/** The public id of the paper a topic key points at, or null when the key belongs to a concept. */
export function paperIdOfTopicKey(topicKey: string): string | null {
  if (!topicKey.startsWith(PAPER_TOPIC_PREFIX)) return null;
  const id = topicKey.slice(PAPER_TOPIC_PREFIX.length);
  return isPublicId(id) ? id : null;
}
