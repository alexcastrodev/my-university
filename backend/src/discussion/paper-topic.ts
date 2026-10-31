/**
 * A paper is a discussion topic like a concept is, but it is not concept content: its identity is the
 * paper id (`paper:<id>`), it has no sections to quote, and its page is /papers/<id>. Only the board at
 * the end of the page applies to it, so there are no paragraph threads for papers.
 */
export const PAPERS_MODULE = 'papers';
export const PAPER_TOPIC_PREFIX = 'paper:';

/** The paper id a topic key points at, or null when the key belongs to a concept. */
export function paperIdOfTopicKey(topicKey: string): number | null {
  if (!topicKey.startsWith(PAPER_TOPIC_PREFIX)) return null;
  const id = Number(topicKey.slice(PAPER_TOPIC_PREFIX.length));
  return Number.isSafeInteger(id) ? id : null;
}
