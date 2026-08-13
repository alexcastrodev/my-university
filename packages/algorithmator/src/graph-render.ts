import * as d3 from 'd3';
import { mountStepper } from './stepper';
import { GraphScene } from './types';

const NODE_RADIUS = 18;
const COL_SPACING = 64;
const ROW_SPACING = 64;
const MARGIN = 24;

const edgeKey = (from: string, to: string): string => `${from}->${to}`;

/**
 * Renders a GraphScene (see graph.ts) — a fixed set of nodes/edges at author-declared grid
 * positions, with a traversal replayed step by step — as an SVG, with playback controls via
 * stepper.ts. Unlike tree-render.ts, the graph's structure never changes (no insert/rotate), so
 * nodes and edges are drawn once; only the visited/current/traversed classes update per step.
 */
export function mountGraph(el: HTMLElement, scene: GraphScene): () => void {
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

  const wrap = document.createElement('div');
  wrap.className = 'concept-viz-tree';
  wrap.appendChild(svg);

  const posOf = new Map(
    scene.nodes.map((n) => [
      n.id,
      { cx: MARGIN + NODE_RADIUS + n.col * COL_SPACING, cy: MARGIN + NODE_RADIUS + n.row * ROW_SPACING },
    ]),
  );

  const maxCol = scene.nodes.length ? Math.max(...scene.nodes.map((n) => n.col)) : 0;
  const maxRow = scene.nodes.length ? Math.max(...scene.nodes.map((n) => n.row)) : 0;
  svg.setAttribute('width', String(MARGIN * 2 + NODE_RADIUS * 2 + maxCol * COL_SPACING));
  svg.setAttribute('height', String(MARGIN * 2 + NODE_RADIUS * 2 + maxRow * ROW_SPACING));

  const edgeEls = new Map<string, SVGLineElement>();
  d3.select(edgesGroup)
    .selectAll<SVGLineElement, (typeof scene.edges)[number]>('line')
    .data(scene.edges)
    .join('line')
    .attr('class', 'concept-viz-tree-edge')
    .attr('x1', (d) => posOf.get(d.from)!.cx)
    .attr('y1', (d) => posOf.get(d.from)!.cy)
    .attr('x2', (d) => posOf.get(d.to)!.cx)
    .attr('y2', (d) => posOf.get(d.to)!.cy)
    .each(function (d) {
      edgeEls.set(edgeKey(d.from, d.to), this);
      if (!d.directed) edgeEls.set(edgeKey(d.to, d.from), this);
    });

  const nodeEls = new Map<string, SVGGElement>();
  const nodeSel = d3
    .select(nodesGroup)
    .selectAll<SVGGElement, (typeof scene.nodes)[number]>('g')
    .data(scene.nodes)
    .join('g')
    .attr('class', 'concept-viz-tree-node')
    .attr('transform', (d) => `translate(${posOf.get(d.id)!.cx},${posOf.get(d.id)!.cy})`)
    .each(function (d) {
      nodeEls.set(d.id, this);
    });
  nodeSel.append('circle').attr('r', NODE_RADIUS);
  nodeSel.append('text').attr('text-anchor', 'middle').attr('dy', '0.32em').text((d) => d.label);

  const stepper = mountStepper(el, scene.meta, {
    totalSteps: scene.steps.length,
    captionFor: (index) => (index === -1 ? '' : scene.steps[index].caption),
    onStep: (target) => {
      const visited = new Set<string>();
      const traversed = new Set<string>();
      let currentId: string | undefined;

      for (let i = 0; i <= target; i++) {
        const step = scene.steps[i];
        if (step.visit) {
          visited.add(step.visit.id);
          if (i === target) currentId = step.visit.id;
        }
        if (step.traverseEdge) traversed.add(edgeKey(step.traverseEdge.from, step.traverseEdge.to));
      }
      const targetStep = target >= 0 ? scene.steps[target] : null;
      const markedId = targetStep?.highlight?.id;

      nodeEls.forEach((elm, id) => {
        d3.select(elm)
          .classed('concept-viz-tree-node--visited', visited.has(id))
          .classed('concept-viz-tree-node--pointer', id === currentId)
          .classed('concept-viz-tree-node--flash', id === markedId);
      });
      edgeEls.forEach((elm, key) => {
        d3.select(elm).classed('concept-viz-tree-edge--traversed', traversed.has(key));
      });
    },
  });

  el.appendChild(stepper.header);
  el.appendChild(wrap);
  el.appendChild(stepper.caption);

  stepper.start();

  return () => stepper.destroy();
}
