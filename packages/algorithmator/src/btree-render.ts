import * as d3 from 'd3';
import { mountStepper } from './stepper';
import { BTreeScene, BTreeStep } from './types';

const KEY_WIDTH = 34;
const NODE_HEIGHT = 34;
const X_SPACING = 120;
const Y_SPACING = 92;
const MARGIN = 24;
const LEFT_PAD = 60;
const TRANSITION_MS = 380;

interface NodeState {
  id: string;
  keys: string[];
  parent: string | null;
  index: number;
}

interface Position {
  x: number;
  y: number;
}

function applyStep(nodes: Map<string, NodeState>, step: BTreeStep): void {
  if (step.node) {
    const { id, keys, parent, index } = step.node;
    nodes.set(id, { id, keys, parent, index: index ?? 0 });
  }
  if (step.remove) {
    nodes.delete(step.remove.id);
  }
}

function childrenOf(nodes: Map<string, NodeState>, parentId: string): string[] {
  return [...nodes.values()]
    .filter((n) => n.parent === parentId)
    .sort((a, b) => a.index - b.index)
    .map((n) => n.id);
}

/**
 * Positions every node by "children center under their parent, leaves tick left to right" — the
 * generalization of tree-render.ts's binary in-order-position × depth layout to a node that can
 * have more than two children. A leaf gets the next open column; an internal node sits at the
 * midpoint of its own children's columns (computed bottom-up, after they're placed), so the whole
 * tree comes out centered without the content author ever specifying a coordinate.
 */
function computeLayout(nodes: Map<string, NodeState>, rootId: string | null): Map<string, Position> {
  const positions = new Map<string, Position>();
  let counter = 0;

  const visit = (id: string, depth: number): void => {
    if (!nodes.has(id)) return;
    const children = childrenOf(nodes, id);
    if (children.length === 0) {
      positions.set(id, { x: counter, y: depth });
      counter++;
      return;
    }
    for (const childId of children) visit(childId, depth + 1);
    const xs = children.map((childId) => positions.get(childId)?.x).filter((x): x is number => x !== undefined);
    positions.set(id, { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: depth });
  };

  if (rootId) visit(rootId, 0);
  return positions;
}

function findRootId(nodes: Map<string, NodeState>): string | null {
  return [...nodes.values()].find((n) => n.parent === null)?.id ?? null;
}

/** Rebuilds a node's key cells (background box, dividers, key labels) to match its current key
 *  set. Called on every render pass rather than D3-joined itself: a node's own position slides
 *  smoothly between steps (the outer `<g>` is the persistent, transitioned element), but its key
 *  count can change step to step (a key inserted, or the promoted set after a split), so the
 *  cheapest correct thing is to redraw the small fixed content inside it from scratch. */
function renderNodeBody(
  g: SVGGElement,
  node: NodeState,
  flashKeyValue: string | undefined,
): void {
  const sel = d3.select(g);
  sel.selectAll('.concept-viz-btree-box, .concept-viz-btree-divider, .concept-viz-btree-key').remove();

  const width = node.keys.length * KEY_WIDTH;
  const x0 = -width / 2;

  sel
    .insert('rect', ':first-child')
    .attr('class', 'concept-viz-btree-box')
    .attr('x', x0)
    .attr('y', -NODE_HEIGHT / 2)
    .attr('width', width)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 4);

  for (let i = 1; i < node.keys.length; i++) {
    sel
      .append('line')
      .attr('class', 'concept-viz-btree-divider')
      .attr('x1', x0 + i * KEY_WIDTH)
      .attr('x2', x0 + i * KEY_WIDTH)
      .attr('y1', -NODE_HEIGHT / 2)
      .attr('y2', NODE_HEIGHT / 2);
  }

  node.keys.forEach((key, i) => {
    sel
      .append('text')
      .attr('class', 'concept-viz-btree-key')
      .classed('concept-viz-btree-key--flash', key === flashKeyValue)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.32em')
      .attr('x', x0 + i * KEY_WIDTH + KEY_WIDTH / 2)
      .text(key);
  });
}

/**
 * Renders a BTreeScene (see btree.ts) — a multiway tree replayed step by step from a flat
 * `node`/`remove`/`mark`/`mark-key` command list — as an SVG, auto-laid-out by computeLayout,
 * playback controls via stepper.ts. Same persistent-DOM-element-per-id technique as
 * tree-render.ts's binary trees: a node that survives a split's parent update is the same `<g>`
 * sliding to its new position, not a fade-out/fade-in pair. Edges attach at the specific pointer
 * slot between two keys (child i sits between key[i-1] and key[i]) rather than the node's plain
 * center, matching the physical node layout the B-trees concept's own diagrams use.
 */
export function mountBTree(el: HTMLElement, scene: BTreeScene): () => void {
  el.innerHTML = '';
  el.classList.add('concept-viz-root');

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'concept-viz-tree-svg');
  const edgesGroup = document.createElementNS(svgNs, 'g');
  edgesGroup.setAttribute('class', 'concept-viz-tree-edges');
  const nodesGroup = document.createElementNS(svgNs, 'g');
  nodesGroup.setAttribute('class', 'concept-viz-tree-nodes');
  svg.appendChild(edgesGroup);
  svg.appendChild(nodesGroup);

  const treeWrap = document.createElement('div');
  treeWrap.className = 'concept-viz-tree';
  treeWrap.appendChild(svg);

  const nodeEls = new Map<string, SVGGElement>();

  const px = (pos: Position): { cx: number; cy: number } => ({
    cx: MARGIN + LEFT_PAD + pos.x * X_SPACING,
    cy: MARGIN + NODE_HEIGHT / 2 + pos.y * Y_SPACING,
  });

  /** The x-offset (from a node's own center) of the pointer slot leading to child #index. */
  const slotOffset = (node: NodeState, index: number): number => {
    const width = node.keys.length * KEY_WIDTH;
    return index * KEY_WIDTH - width / 2;
  };

  const render = (
    nodes: Map<string, NodeState>,
    positions: Map<string, Position>,
    highlightId: string | undefined,
    highlightClass: string,
    highlightKey: { id: string; key: string } | undefined,
  ): void => {
    const maxX = positions.size ? Math.max(...[...positions.values()].map((p) => p.x)) : 0;
    const maxY = positions.size ? Math.max(...[...positions.values()].map((p) => p.y)) : 0;
    svg.setAttribute('width', String(MARGIN * 2 + LEFT_PAD * 2 + maxX * X_SPACING));
    svg.setAttribute('height', String(MARGIN * 2 + NODE_HEIGHT + maxY * Y_SPACING));

    const edgeData = [...nodes.values()].filter((n) => n.parent && positions.has(n.id) && positions.has(n.parent));

    d3.select(edgesGroup)
      .selectAll<SVGLineElement, NodeState>('line')
      .data(edgeData, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('line')
            .attr('class', 'concept-viz-tree-edge')
            .attr('x1', (d) => px(positions.get(d.parent!)!).cx + slotOffset(nodes.get(d.parent!)!, d.index))
            .attr('y1', (d) => px(positions.get(d.parent!)!).cy + NODE_HEIGHT / 2)
            .attr('x2', (d) => px(positions.get(d.id)!).cx)
            .attr('y2', (d) => px(positions.get(d.id)!).cy - NODE_HEIGHT / 2)
            .style('opacity', 0)
            .transition()
            .duration(TRANSITION_MS)
            .style('opacity', 1),
        (update) =>
          update
            .transition()
            .duration(TRANSITION_MS)
            .attr('x1', (d) => px(positions.get(d.parent!)!).cx + slotOffset(nodes.get(d.parent!)!, d.index))
            .attr('y1', (d) => px(positions.get(d.parent!)!).cy + NODE_HEIGHT / 2)
            .attr('x2', (d) => px(positions.get(d.id)!).cx)
            .attr('y2', (d) => px(positions.get(d.id)!).cy - NODE_HEIGHT / 2),
        (exit) => exit.transition().duration(TRANSITION_MS).style('opacity', 0).remove(),
      );

    const nodeData = [...nodes.values()].filter((n) => positions.has(n.id));

    const nodeSel = d3
      .select(nodesGroup)
      .selectAll<SVGGElement, NodeState>('g.concept-viz-tree-node')
      .data(nodeData, (d) => d.id)
      .join(
        (enter) => {
          const g = enter
            .append('g')
            .attr('class', 'concept-viz-tree-node')
            .attr('transform', (d) => {
              const { cx, cy } = px(positions.get(d.id)!);
              return `translate(${cx},${cy}) scale(0.6)`;
            })
            .style('opacity', 0);
          g.each(function (d) {
            nodeEls.set(d.id, this);
          });
          g.transition()
            .duration(TRANSITION_MS)
            .style('opacity', 1)
            .attr('transform', (d) => {
              const { cx, cy } = px(positions.get(d.id)!);
              return `translate(${cx},${cy}) scale(1)`;
            });
          return g;
        },
        (update) =>
          update
            .transition()
            .duration(TRANSITION_MS)
            .attr('transform', (d) => {
              const { cx, cy } = px(positions.get(d.id)!);
              return `translate(${cx},${cy}) scale(1)`;
            }),
        (exit) => {
          exit.each(function (d) {
            nodeEls.delete(d.id);
          });
          return exit
            .transition()
            .duration(TRANSITION_MS)
            .style('opacity', 0)
            .attr('transform', function () {
              return `${this.getAttribute('transform')} scale(0.6)`;
            })
            .remove();
        },
      )
      .classed('concept-viz-tree-node--flash', (d) => d.id === highlightId && highlightClass === 'flash')
      .classed('concept-viz-tree-node--pointer', (d) => d.id === highlightId && highlightClass === 'pointer');

    nodeSel.each(function (d) {
      renderNodeBody(this, d, highlightKey?.id === d.id ? highlightKey.key : undefined);
    });
  };

  const stepper = mountStepper(el, scene.meta, {
    totalSteps: scene.steps.length,
    captionFor: (index) => (index === -1 ? '' : scene.steps[index].caption),
    onStep: (target) => {
      const nodes = new Map<string, NodeState>();
      for (let i = 0; i <= target; i++) applyStep(nodes, scene.steps[i]);

      const rootId = findRootId(nodes);
      const positions = computeLayout(nodes, rootId);

      const targetStep = target >= 0 ? scene.steps[target] : null;
      let highlightId: string | undefined;
      let highlightClass = '';
      if (targetStep?.highlight) {
        highlightId = targetStep.highlight.id;
        highlightClass = 'flash';
      } else if (targetStep?.node) {
        highlightId = targetStep.node.id;
        highlightClass = 'pointer';
      }

      render(nodes, positions, highlightId, highlightClass, targetStep?.highlightKey);
    },
  });

  el.appendChild(stepper.header);
  el.appendChild(treeWrap);
  el.appendChild(stepper.caption);

  stepper.start();

  return () => stepper.destroy();
}
