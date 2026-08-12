import { mountViz } from './engine';
import { compileFormula } from './formula';

function parseFenceSource(source: string): { type: string; body: string } {
  const lines = source.split('\n');
  const typeLineIndex = lines.findIndex((line) => line.trim().length > 0);
  const type = /^type:\s*(.+)$/.exec((lines[typeLineIndex] ?? '').trim())?.[1]?.trim() ?? '';
  return { type, body: lines.slice(typeLineIndex + 1).join('\n') };
}

function splitConfigAndItems(body: string): { config: string; items: string[] } {
  const lines = body.split('\n');
  const separatorIndex = lines.findIndex((line) => line.trim() === '---');
  if (separatorIndex === -1) {
    return { config: '', items: lines.map((line) => line.trim()).filter(Boolean) };
  }
  return {
    config: lines.slice(0, separatorIndex).join('\n'),
    items: lines
      .slice(separatorIndex + 1)
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

/**
 * The whole public entry point: given the raw text of a ```viz fence block (starting with a
 * `type: <mode>` line) and an element you own, builds the scene and animates it into that
 * element. Returns a cleanup function — call it before discarding `el` to cancel pending timers.
 *
 * Today the only supported type is `formula` — see formula.ts for its syntax.
 */
export function renderConceptViz(el: HTMLElement, source: string): () => void {
  const { type, body } = parseFenceSource(source);

  if (type === 'formula') {
    const { config, items } = splitConfigAndItems(body);
    try {
      const scene = compileFormula(config)(items);
      return mountViz(el, scene);
    } catch (error) {
      el.textContent = `Formula error: ${(error as Error).message}`;
      return () => {};
    }
  }

  el.textContent = `Unknown visualization type: "${type}"`;
  return () => {};
}

export { mountViz } from './engine';
export { compileFormula } from './formula';
export { placementMode } from './placement';
export type { PlacementConfig } from './placement';
export * from './types';
