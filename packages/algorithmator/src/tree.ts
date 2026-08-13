import { TreeScene, TreeStep } from './types';

type Command =
  | { type: 'insert'; id: string; label: string; parent: string | null; side?: 'left' | 'right'; color?: string; note?: string }
  | { type: 'recolor'; id: string; color: string; note?: string }
  | { type: 'rotate-left'; at: string; note?: string }
  | { type: 'rotate-right'; at: string; note?: string }
  | { type: 'remove'; id: string; note?: string }
  | { type: 'mark'; id: string; note?: string };

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
    case 'insert': {
      // insert <id> <label> [parent=<id>] [side=left|right] [color=red|black]
      const id = args[0];
      const label = args[1];
      const kv = parseKeyValueArgs(args.slice(2));
      const side = kv['side'] === 'left' || kv['side'] === 'right' ? kv['side'] : undefined;
      return { type: 'insert', id, label, parent: kv['parent'] ?? null, side, color: kv['color'], note };
    }
    case 'recolor':
      return { type: 'recolor', id: args[0], color: args[1], note };
    case 'rotate-left':
      return { type: 'rotate-left', at: args[0], note };
    case 'rotate-right':
      return { type: 'rotate-right', at: args[0], note };
    case 'remove':
      return { type: 'remove', id: args[0], note };
    case 'mark':
      return { type: 'mark', id: args[0], note };
    default:
      throw new Error(`Unknown tree command: "${cmd}" (expected insert/recolor/rotate-left/rotate-right/remove/mark)`);
  }
}

const defaultCaption: Record<Command['type'], (c: Command) => string> = {
  insert: (c) => {
    const ic = c as Extract<Command, { type: 'insert' }>;
    return ic.parent
      ? `Insert "${ic.label}" as the ${ic.side ?? 'left'} child of "${ic.parent}".`
      : `Insert "${ic.label}" as the root.`;
  },
  recolor: (c) => {
    const rc = c as Extract<Command, { type: 'recolor' }>;
    return `Recolor "${rc.id}" ${rc.color}.`;
  },
  'rotate-left': (c) => `Rotate left at "${(c as Extract<Command, { type: 'rotate-left' }>).at}".`,
  'rotate-right': (c) => `Rotate right at "${(c as Extract<Command, { type: 'rotate-right' }>).at}".`,
  remove: (c) => `Remove "${(c as Extract<Command, { type: 'remove' }>).id}".`,
  mark: (c) => `Look at "${(c as Extract<Command, { type: 'mark' }>).id}".`,
};

/**
 * Compiles a flat, declarative list of tree-editing commands — no code, no computed BST-insert
 * logic — into a TreeScene the tree renderer plays back. Same philosophy as moves.ts: the content
 * author (or a throwaway script) works out the real algorithm's structural changes by hand ahead
 * of time — where a node lands, when a rotation happens, when a node recolors — and the engine
 * just replays them faithfully. This is what lets one command language cover a plain BST insert
 * trace and a red-black tree's insert-fixup (rotations + recoloring) equally well:
 *
 *   insert <id> <label> [parent=<id>] [side=left|right] [color=red|black] [| note]
 *   recolor <id> <red|black> [| note]
 *   rotate-left <id> [| note]     — CLRS's LEFT-ROTATE, pivoting on the named node
 *   rotate-right <id> [| note]    — CLRS's RIGHT-ROTATE, pivoting on the named node
 *   remove <id> [| note]          — only valid for a leaf or single-child node
 *   mark <id> [| note]            — flash a node without changing the tree
 */
export function compileTree(commandsText: string): TreeScene {
  const commands = commandsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCommandLine);

  const steps: TreeStep[] = commands.map((cmd) => {
    const caption = cmd.note ?? defaultCaption[cmd.type](cmd);
    switch (cmd.type) {
      case 'insert':
        return { caption, insert: { id: cmd.id, label: cmd.label, parent: cmd.parent, side: cmd.side, color: cmd.color } };
      case 'recolor':
        return { caption, recolor: { id: cmd.id, color: cmd.color } };
      case 'rotate-left':
        return { caption, rotateLeft: { at: cmd.at } };
      case 'rotate-right':
        return { caption, rotateRight: { at: cmd.at } };
      case 'remove':
        return { caption, remove: { id: cmd.id } };
      case 'mark':
        return { caption, highlight: { id: cmd.id } };
    }
  });

  return { steps };
}
