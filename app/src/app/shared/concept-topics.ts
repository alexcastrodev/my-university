export interface ConceptTopicGroup<T> {
  topic: string;
  concepts: T[];
}

/**
 * Groups concepts by topic, topics in the given pedagogical order (unknown topics last,
 * alphabetically). Within a topic the incoming order is kept, so callers pass the backend's
 * prerequisite order and each group stays in real reading order.
 */
export function groupByTopic<T extends { topic: string }>(
  items: readonly T[],
  topicOrder: readonly string[],
): ConceptTopicGroup<T>[] {
  const byTopic = new Map<string, T[]>();
  for (const item of items) {
    const group = byTopic.get(item.topic);
    if (group) group.push(item);
    else byTopic.set(item.topic, [item]);
  }

  const known = topicOrder.filter((topic) => byTopic.has(topic));
  const unknown = [...byTopic.keys()].filter((topic) => !topicOrder.includes(topic)).sort();
  return [...known, ...unknown].map((topic) => ({ topic, concepts: byTopic.get(topic)! }));
}

/** The concepts in the same order the list page shows them: topic by topic. */
export function orderByTopic<T extends { topic: string }>(items: readonly T[], topicOrder: readonly string[]): T[] {
  return groupByTopic(items, topicOrder).flatMap((group) => group.concepts);
}
