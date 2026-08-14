import { BTreeScene, BTreeStep } from './types';

type Command =
  | { type: 'node'; id: string; keys: string[]; parent: string | null; index?: number; note?: string }
  | { type: 'remove'; id: string; note?: string }
  | { type: 'mark'; id: string; note?: string }
  | { type: 'mark-key'; id: string; key: string; note?: string };

function parseKeyValueArgs(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf('=');
    if (eq === -1) continue;
    out[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  return out;
}

function parseCommandLine(line: string): Command {
  const [body, note] = line.split('|').map((s) => s.trim());
  const [cmd, ...args] = body.split(/\s+/);

  switch (cmd) {
    case 'node': {
      // node <id> keys=<K1,K2,...> [parent=<id>] [index=<n>]
      const id = args[0];
      const kv = parseKeyValueArgs(args.slice(1));
      const keys = (kv['keys'] ?? '').split(',').filter(Boolean);
      const parent = kv['parent'] ?? null;
      const index = kv['index'] !== undefined ? Number(kv['index']) : undefined;
      return { type: 'node', id, keys, parent, index, note };
    }
    case 'remove':
      return { type: 'remove', id: args[0], note };
    case 'mark':
      return { type: 'mark', id: args[0], note };
    case 'mark-key':
      return { type: 'mark-key', id: args[0], key: args[1], note };
    default:
      throw new Error(`Unknown btree command: "${cmd}" (expected node/remove/mark/mark-key)`);
  }
}

const defaultCaption: Record<Command['type'], (c: Command) => string> = {
  node: (c) => {
    const nc = c as Extract<Command, { type: 'node' }>;
    const keys = nc.keys.join(', ');
    return nc.parent
      ? `Node "${nc.id}" holds keys ${keys} (child #${nc.index ?? 0} of "${nc.parent}").`
      : `Node "${nc.id}" holds keys ${keys} (root).`;
  },
  remove: (c) => `Remove node "${(c as Extract<Command, { type: 'remove' }>).id}".`,
  mark: (c) => `Look at node "${(c as Extract<Command, { type: 'mark' }>).id}".`,
  'mark-key': (c) => {
    const mc = c as Extract<Command, { type: 'mark-key' }>;
    return `Look at key "${mc.key}" in node "${mc.id}".`;
  },
};

/**
 * Compiles a flat, declarative list of B-tree-editing commands — same philosophy as tree.ts, no
 * code, no computed B-TREE-INSERT/DELETE logic — into a BTreeScene the btree renderer plays back.
 * `node` is a full upsert (not a diff): every step that touches a node restates its complete key
 * set and attachment point, because unlike a BST/red-black node's single immutable key, a B-tree
 * node's key set legitimately changes in place (a key inserted into a not-yet-full node) as well
 * as on a split (the old id is `remove`d, two new ids replace it, and the promoted median lands
 * in a `node` step for the parent):
 *
 *   node <id> keys=<K1,K2,...> [parent=<id>] [index=<n>] [| note]
 *   remove <id> [| note]                — a node absorbed into a split, or an emptied-out old root
 *   mark <id> [| note]                  — flash a whole node without changing the tree
 *   mark-key <id> <key> [| note]        — flash one key within a node (e.g. a promoting median)
 */
export function compileBTree(commandsText: string): BTreeScene {
  const commands = commandsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCommandLine);

  const steps: BTreeStep[] = commands.map((cmd) => {
    const caption = cmd.note ?? defaultCaption[cmd.type](cmd);
    switch (cmd.type) {
      case 'node':
        return { caption, node: { id: cmd.id, keys: cmd.keys, parent: cmd.parent, index: cmd.index } };
      case 'remove':
        return { caption, remove: { id: cmd.id } };
      case 'mark':
        return { caption, highlight: { id: cmd.id } };
      case 'mark-key':
        return { caption, highlightKey: { id: cmd.id, key: cmd.key } };
    }
  });

  return { steps };
}
