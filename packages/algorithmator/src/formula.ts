import { create, all, EvalFunction } from 'mathjs';
import { FORMULA_FUNCTIONS } from './math-fns';
import { VizMode, VizSlot } from './types';

const math = create(all);

interface Declaration {
  name: string;
  node: EvalFunction;
}

function parseDeclarations(config: string): Declaration[] {
  return config
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const eq = line.indexOf('=');
      if (eq === -1) {
        throw new Error(`Invalid formula line (expected "name = expression"): "${line}"`);
      }
      const name = line.slice(0, eq).trim();
      const expr = line.slice(eq + 1).trim();
      return { name, node: math.compile(expr) };
    });
}

// Java's natural ordering: numeric comparison when both sides parse as finite numbers
// (matching Integer/Double.compareTo), otherwise code-point string comparison
// (matching String.compareTo — not locale-aware collation).
function naturalCompare(a: string, b: string): number {
  const an = Number(a);
  const bn = Number(b);
  const bothNumeric = a.trim() !== '' && b.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn);
  if (bothNumeric) return an - bn;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Compiles `name = expression` declaration lines (one per line) into a reusable VizMode — no
 * TypeScript needed per visualization, just a formula. Must declare `slot`; every other
 * declaration (most commonly `capacity`) is evaluated once per scene and available to `slot`.
 *
 * Automatic variables: `count` (total items, available to every declaration), plus `item` and
 * `index` (current item and its 0-based position), available only to the `slot` expression.
 * Built-ins available everywhere: hash(), spread(), nextPow2(), rank() — rank(item) is the
 * item's 0-based position under Java natural ordering across the *whole* item list (numeric if
 * every item parses as a number, otherwise code-point string order), useful for sorted
 * structures like TreeSet/TreeMap where arrival order and final position differ — plus mathjs's
 * own operators/functions (+ - * / % & | ^ << >> ~, min, max, abs, ...).
 *
 * When a numeric `capacity` is declared, slots 0..capacity-1 are generated automatically.
 * Otherwise slots are derived from the distinct values `slot` actually produces, in the order
 * they first appear.
 */
export function compileFormula(config: string): VizMode {
  const declarations = parseDeclarations(config);
  const slotDecl = declarations.find((d) => d.name === 'slot');
  if (!slotDecl) throw new Error('Formula must declare "slot = <expression>"');
  const priorDecls = declarations.filter((d) => d.name !== 'slot');

  return (items) => {
    const rankOf = new Map<string, number>();
    [...items].sort(naturalCompare).forEach((item, i) => {
      if (!rankOf.has(item)) rankOf.set(item, i);
    });
    const rank = (item: string): number => rankOf.get(item) ?? -1;

    const scope: Record<string, unknown> = { ...FORMULA_FUNCTIONS, rank, count: items.length };
    for (const { name, node } of priorDecls) scope[name] = node.evaluate(scope);

    const slotOf = (item: string, index: number): string =>
      String(slotDecl.node.evaluate({ ...scope, item, index }));

    const capacity = scope['capacity'];
    const hasCapacity = typeof capacity === 'number' && Number.isFinite(capacity);

    let slots: VizSlot[];
    if (hasCapacity) {
      slots = Array.from({ length: capacity as number }, (_, i) => ({ id: String(i), label: String(i) }));
    } else {
      const seen = new Set<string>();
      slots = [];
      items.forEach((item, index) => {
        const id = slotOf(item, index);
        if (!seen.has(id)) {
          seen.add(id);
          slots.push({ id, label: id });
        }
      });
    }

    const seenSlots = new Set<string>();
    const collisions = new Set<string>();
    items.forEach((item, index) => {
      const slot = slotOf(item, index);
      if (seenSlots.has(slot)) collisions.add(slot);
      seenSlots.add(slot);
    });

    return {
      meta: hasCapacity ? `Capacity: ${capacity}` : undefined,
      slots,
      steps: items.map((item, index) => {
        const slot = slotOf(item, index);
        const caption = collisions.has(slot)
          ? `"${item}" collides in slot ${slot}`
          : `"${item}" → slot ${slot}`;
        return { caption, place: { token: item, slot } };
      }),
    };
  };
}
