import { VizMode, VizScene, VizSlot, VizStep } from './types';

type Command =
  | { type: 'swap'; i: number; j: number; note?: string }
  | { type: 'mark'; i: number; note?: string }
  | { type: 'move'; token: string; slot: string; note?: string }
  | { type: 'remove'; token: string; note?: string };

function parseCommandLine(line: string): Command {
  const [body, note] = line.split('|').map((s) => s.trim());
  const [cmd, ...args] = body.split(/\s+/);
  switch (cmd) {
    case 'swap':
      return { type: 'swap', i: Number(args[0]), j: Number(args[1]), note };
    case 'mark':
      return { type: 'mark', i: Number(args[0]), note };
    case 'move':
      return { type: 'move', token: args[0], slot: args[1], note };
    case 'remove':
      return { type: 'remove', token: args[0], note };
    default:
      throw new Error(`Unknown move command: "${cmd}" (expected swap/mark/move/remove)`);
  }
}

/**
 * Compiles a flat list of animation commands — no code, no expressions, just the moves
 * themselves — into a VizMode. The content author (or a script) works out the exact sequence of
 * swaps/marks up front; this just replays them faithfully:
 *
 *   swap <i> <j> [| note]        exchange the elements currently at array positions i and j
 *   mark <i> [| note]            flash position i without moving anything (e.g. a pivot)
 *   move <token> <slot> [| note] reparent an existing token into a different slot (e.g. LRU bump)
 *   remove <token> [| note]      remove an existing token from the scene (e.g. cache eviction)
 *
 * The optional `| note` explains *why* the move happens (a comparison result, which pointer
 * moved) — without it, the caption is just a mechanical "swap a[i] and a[j]" description.
 *
 * Rendered as a connected, single-row array (see `layout: 'row'`) rather than the wrapping
 * grid `formula`-mode scenes use — order and adjacency matter for a sequence being sorted, so
 * elements slide between positions instead of fading in/out at each slot independently.
 */
export function compileMoves(commandsText: string): VizMode {
  const commands = commandsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCommandLine);

  return (items) => {
    const a = items.slice();
    const steps: VizStep[] = items.map((token, i) => ({
      caption: `Initial: a[${i}] = "${token}"`,
      place: { token, slot: String(i) },
    }));

    for (const cmd of commands) {
      if (cmd.type === 'swap') {
        const { i, j } = cmd;
        if (i !== j) {
          const tokenI = a[i];
          const tokenJ = a[j];
          a[i] = tokenJ;
          a[j] = tokenI;
          steps.push({
            caption: cmd.note ?? `Swap a[${i}] and a[${j}]: "${tokenI}" ↔ "${tokenJ}"`,
            swap: { tokenA: tokenI, tokenB: tokenJ },
          });
        }
      } else if (cmd.type === 'mark') {
        steps.push({ caption: cmd.note ?? `Mark a[${cmd.i}] = "${a[cmd.i]}"`, highlight: { slot: String(cmd.i) } });
      } else if (cmd.type === 'move') {
        steps.push({
          caption: cmd.note ?? `Move "${cmd.token}" to slot ${cmd.slot}`,
          move: { token: cmd.token, toSlot: cmd.slot },
        });
      } else {
        steps.push({ caption: cmd.note ?? `Remove "${cmd.token}"`, remove: { token: cmd.token } });
      }
    }

    const slots: VizSlot[] = items.map((_, i) => ({ id: String(i), label: String(i) }));
    return { meta: `${items.length} elements`, slots, steps, layout: 'row' } satisfies VizScene;
  };
}
