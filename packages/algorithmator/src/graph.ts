import { GraphEdgeSpec, GraphNodeSpec, GraphScene, GraphStep } from './types';

function parseConfig(config: string): { nodes: GraphNodeSpec[]; edges: GraphEdgeSpec[] } {
  const nodes: GraphNodeSpec[] = [];
  const edges: GraphEdgeSpec[] = [];
  for (const rawLine of config.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const [cmd, ...args] = line.split(/\s+/);
    if (cmd === 'node') {
      const [id, label, col, row] = args;
      nodes.push({ id, label, col: Number(col), row: Number(row) });
    } else if (cmd === 'edge') {
      const [from, to, ...rest] = args;
      edges.push({ from, to, directed: rest.includes('directed') });
    } else {
      throw new Error(`Unknown graph declaration: "${cmd}" (expected node/edge)`);
    }
  }
  return { nodes, edges };
}

function parseSteps(itemsText: string): GraphStep[] {
  return itemsText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [body, note] = line.split('|').map((s) => s.trim());
      const [cmd, ...args] = body.split(/\s+/);
      if (cmd === 'visit') {
        const id = args[0];
        return { caption: note ?? `Visit "${id}".`, visit: { id } };
      }
      if (cmd === 'traverse') {
        const [from, to] = args;
        return { caption: note ?? `Follow the edge "${from}" → "${to}".`, traverseEdge: { from, to } };
      }
      if (cmd === 'mark') {
        const id = args[0];
        return { caption: note ?? `Look at "${id}".`, highlight: { id } };
      }
      throw new Error(`Unknown graph step: "${cmd}" (expected visit/traverse/mark)`);
    });
}

/**
 * Compiles a graph declaration (fixed node positions + edges) plus a flat list of traversal steps
 * into a GraphScene. General graph auto-layout is nondeterministic and not worth the engine
 * complexity — same reasoning both source books' own figures follow — so node position is
 * authored directly as a small (col, row) grid coordinate, not computed:
 *
 *   node <id> <label> <col> <row>
 *   edge <fromId> <toId> [directed]
 *   ---
 *   visit <id> [| note]              — mark a node visited (e.g. dequeued in BFS)
 *   traverse <fromId> <toId> [| note] — highlight an edge as part of the traversal (tree edge)
 *   mark <id> [| note]                — flash a node without marking it visited
 */
export function compileGraph(source: string): GraphScene {
  const lines = source.split('\n');
  const separatorIndex = lines.findIndex((line) => line.trim() === '---');
  const configText = separatorIndex === -1 ? source : lines.slice(0, separatorIndex).join('\n');
  const stepsText = separatorIndex === -1 ? '' : lines.slice(separatorIndex + 1).join('\n');

  const { nodes, edges } = parseConfig(configText);
  const steps = parseSteps(stepsText);
  return { nodes, edges, steps };
}
