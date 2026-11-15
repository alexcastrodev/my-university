import { Block } from '../discussion/block-anchor';
import { KurzConversation } from './kurz.model';

/**
 * The paragraph a conversation was asked from: the block with the same text at the same place, else the
 * same text elsewhere (a paragraph that moved). Text that changed matches nothing, and that conversation
 * is not drawn on any paragraph (the post is the same page, so it stays in the whole-post list).
 */
export function blockOfConversation(blocks: Block[], conversation: KurzConversation): Block | null {
  if (conversation.anchorKey === null || conversation.blockIndex === null) return null;
  const sameKey = blocks.filter((b) => b.key === conversation.anchorKey);
  const exact = sameKey.find((b) => b.index === conversation.blockIndex);
  if (exact) return exact;
  const index = conversation.blockIndex;
  return sameKey.reduce<Block | null>(
    (best, b) => (!best || Math.abs(b.index - index) < Math.abs(best.index - index) ? b : best),
    null,
  );
}

/** How many conversations each paragraph carries, by block index. */
export function conversationCounts(
  blocks: Block[],
  conversations: KurzConversation[],
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const conversation of conversations) {
    const block = blockOfConversation(blocks, conversation);
    if (block) counts.set(block.index, (counts.get(block.index) ?? 0) + 1);
  }
  return counts;
}

/**
 * The conversations the panel shows for one place of the post, oldest first. `anchorKey: null` is the
 * whole post: the conversations that were not asked from a paragraph. A paragraph is told by its text
 * (the key), so one that moved keeps its conversations.
 */
export function conversationsAt(
  conversations: KurzConversation[],
  anchorKey: string | null,
): KurzConversation[] {
  return conversations
    .filter((c) => c.anchorKey === anchorKey)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
