import * as d3 from 'd3';
import { mountStepper } from './stepper';
import { TreeScene, TreeStep } from './types';

const NODE_RADIUS = 18;
const X_SPACING = 56;
const Y_SPACING = 68;
const MARGIN = 24;
const TRANSITION_MS = 380;

interface NodeState {
  id: string;
  label: string;
  color?: string;
  parent: string | null;
  left: string | null;
  right: string | null;
}

interface Position {
  x: number;
  y: number;
}

function applyStep(nodes: Map<string, NodeState>, root: { id: string | null }, step: TreeStep): void {
  if (step.insert) {
    const { id, label, parent, side, color } = step.insert;
    nodes.set(id, { id, label, color, parent, left: null, right: null });
    if (parent === null) {
      root.id = id;
    } else {
      const parentNode = nodes.get(parent);
      if (!parentNode) return;
      if (side === 'right') parentNode.right = id;
      else parentNode.left = id;
    }
  }
  if (step.recolor) {
    const node = nodes.get(step.recolor.id);
    if (node) node.color = step.recolor.color;
  }
  if (step.rotateLeft) {
    const x = nodes.get(step.rotateLeft.at);
    if (!x || !x.right) return;
    const y = nodes.get(x.right)!;
    x.right = y.left;
    if (y.left) nodes.get(y.left)!.parent = x.id;
    y.parent = x.parent;
    if (x.parent === null) root.id = y.id;
    else {
      const p = nodes.get(x.parent)!;
      if (p.left === x.id) p.left = y.id;
      else p.right = y.id;
    }
    y.left = x.id;
    x.parent = y.id;
  }
  if (step.rotateRight) {
    const x = nodes.get(step.rotateRight.at);
    if (!x || !x.left) return;
    const y = nodes.get(x.left)!;
    x.left = y.right;
    if (y.right) nodes.get(y.right)!.parent = x.id;
    y.parent = x.parent;
    if (x.parent === null) root.id = y.id;
    else {
      const p = nodes.get(x.parent)!;
      if (p.left === x.id) p.left = y.id;
      else p.right = y.id;
    }
    y.right = x.id;
    x.parent = y.id;
  }
  if (step.remove) {
    const node = nodes.get(step.remove.id);
    if (!node) return;
    const child = node.left ?? node.right; // only valid for a leaf or single-child node
    if (child) nodes.get(child)!.parent = node.parent;
    if (node.parent === null) root.id = child;
    else {
      const p = nodes.get(node.parent)!;
      if (p.left === node.id) p.left = child;
      else p.right = child;
    }
    nodes.delete(step.remove.id);
  }
}

/** In-order position (x) × depth (y) — the classic tree-drawing layout both source books' own figures use. */
function computeLayout(nodes: Map<string, NodeState>, rootId: string | null): Map<string, Position> {
  const positions = new Map<string, Position>();
  let counter = 0;

  const inorder = (id: string | null, depth: number): void => {
    if (!id) return;
    const node = nodes.get(id);
    if (!node) return;
    inorder(node.left, depth + 1);
    positions.set(id, { x: counter, y: depth });
    counter++;
    inorder(node.right, depth + 1);
  };

  inorder(rootId, 0);
  return positions;
}

/**
 * Renders a TreeScene (see tree.ts) — a binary tree replayed step by step from a flat command
 * list — as an SVG with nodes positioned by the classic in-order-position × depth layout, edges
 * drawn between parent and child, and playback controls via stepper.ts. Nodes are persistent DOM
 * elements keyed by id (same technique as engine.ts's row-mode tokens): a node that survives a
 * rotation is the *same* circle sliding to its new position, not a fade-out/fade-in pair, so a
 * rotation visibly reads as a rotation.
 */
export function mountTree(el: HTMLElement, scene: TreeScene): () => void {
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
    cx: MARGIN + NODE_RADIUS + pos.x * X_SPACING,
    cy: MARGIN + NODE_RADIUS + pos.y * Y_SPACING,
  });

  const render = (
    nodes: Map<string, NodeState>,
    positions: Map<string, Position>,
    highlightId: string | undefined,
    highlightClass: string,
  ): void => {
    const maxX = positions.size ? Math.max(...[...positions.values()].map((p) => p.x)) : 0;
    const maxY = positions.size ? Math.max(...[...positions.values()].map((p) => p.y)) : 0;
    svg.setAttribute('width', String(MARGIN * 2 + NODE_RADIUS * 2 + maxX * X_SPACING));
    svg.setAttribute('height', String(MARGIN * 2 + NODE_RADIUS * 2 + maxY * Y_SPACING));

    const edgeData = [...nodes.values()].filter((n) => n.parent && positions.has(n.id) && positions.has(n.parent));

    d3.select(edgesGroup)
      .selectAll<SVGLineElement, NodeState>('line')
      .data(edgeData, (d) => d.id)
      .join(
        (enter) =>
          enter
            .append('line')
            .attr('class', 'concept-viz-tree-edge')
            .attr('x1', (d) => px(positions.get(d.parent!)!).cx)
            .attr('y1', (d) => px(positions.get(d.parent!)!).cy)
            .attr('x2', (d) => px(positions.get(d.id)!).cx)
            .attr('y2', (d) => px(positions.get(d.id)!).cy)
            .style('opacity', 0)
            .transition()
            .duration(TRANSITION_MS)
            .style('opacity', 1),
        (update) =>
          update
            .transition()
            .duration(TRANSITION_MS)
            .attr('x1', (d) => px(positions.get(d.parent!)!).cx)
            .attr('y1', (d) => px(positions.get(d.parent!)!).cy)
            .attr('x2', (d) => px(positions.get(d.id)!).cx)
            .attr('y2', (d) => px(positions.get(d.id)!).cy),
        (exit) => exit.transition().duration(TRANSITION_MS).style('opacity', 0).remove(),
      );

    const nodeData = [...nodes.values()].filter((n) => positions.has(n.id));

    d3.select(nodesGroup)
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
          g.append('circle').attr('r', NODE_RADIUS);
          g.append('text').attr('text-anchor', 'middle').attr('dy', '0.32em').text((d) => d.label);
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
          return exit.transition().duration(TRANSITION_MS).style('opacity', 0).attr('transform', function () {
            return `${this.getAttribute('transform')} scale(0.6)`;
          }).remove();
        },
      )
      .attr('data-color', (d) => d.color ?? '')
      .classed('concept-viz-tree-node--flash', (d) => d.id === highlightId && highlightClass === 'flash')
      .classed('concept-viz-tree-node--pointer', (d) => d.id === highlightId && highlightClass === 'pointer');
  };

  const stepper = mountStepper(el, scene.meta, {
    totalSteps: scene.steps.length,
    captionFor: (index) => (index === -1 ? '' : scene.steps[index].caption),
    onStep: (target) => {
      const nodes = new Map<string, NodeState>();
      const root: { id: string | null } = { id: null };
      for (let i = 0; i <= target; i++) applyStep(nodes, root, scene.steps[i]);

      const positions = computeLayout(nodes, root.id);

      const targetStep = target >= 0 ? scene.steps[target] : null;
      let highlightId: string | undefined;
      let highlightClass = '';
      if (targetStep?.highlight) {
        highlightId = targetStep.highlight.id;
        highlightClass = 'flash';
      } else if (targetStep?.rotateLeft) {
        highlightId = targetStep.rotateLeft.at;
        highlightClass = 'pointer';
      } else if (targetStep?.rotateRight) {
        highlightId = targetStep.rotateRight.at;
        highlightClass = 'pointer';
      } else if (targetStep?.insert) {
        highlightId = targetStep.insert.id;
        highlightClass = 'pointer';
      }

      render(nodes, positions, highlightId, highlightClass);
    },
  });

  el.appendChild(stepper.header);
  el.appendChild(treeWrap);
  el.appendChild(stepper.caption);

  stepper.start();

  return () => stepper.destroy();
}
