import * as d3 from 'd3';
import { VizScene } from './types';

const STEP_DELAY_MS = 900;
const TRANSITION_MS = 300;

/**
 * Renders `scene.slots` once, then plays `scene.steps` as a timeline into `el`. Each step only
 * mutates a token->slot state map; the actual DOM is a D3 enter/update/exit join re-run after
 * every step, so any place/move/remove/highlight combination "just animates" with no bespoke
 * DOM code per visualization. Framework-agnostic — pass any HTMLElement you own.
 *
 * Returns a cleanup function that cancels any pending animation timers.
 */
export function mountViz(el: HTMLElement, scene: VizScene): () => void {
  el.innerHTML = '';
  el.classList.add('concept-viz-root');

  const header = document.createElement('div');
  header.className = 'concept-viz-header';
  header.innerHTML = `<span>${scene.meta ?? ''}</span>`;
  const replayBtn = document.createElement('button');
  replayBtn.type = 'button';
  replayBtn.className = 'concept-viz-replay-btn';
  replayBtn.textContent = '↻ Replay';
  header.appendChild(replayBtn);
  el.appendChild(header);

  const queueEl = document.createElement('div');
  queueEl.className = 'concept-viz-queue';
  el.appendChild(queueEl);

  const slotsEl = document.createElement('div');
  slotsEl.className = 'concept-viz-slots';
  el.appendChild(slotsEl);

  const caption = document.createElement('div');
  caption.className = 'concept-viz-caption';
  el.appendChild(caption);

  const slotEls = new Map<string, HTMLElement>();
  scene.slots.forEach((slot) => {
    const slotEl = document.createElement('div');
    slotEl.className = 'concept-viz-slot';
    slotEl.innerHTML = `<span class="concept-viz-slot-label">${slot.label}</span>`;
    slotsEl.appendChild(slotEl);
    slotEls.set(slot.id, slotEl);
  });

  const allTokens = [...new Set(scene.steps.filter((s) => s.place).map((s) => s.place!.token))];

  let timers: ReturnType<typeof setTimeout>[] = [];

  const run = (): void => {
    timers.forEach(clearTimeout);
    timers = [];
    caption.textContent = '';

    const tokenSlot = new Map<string, string>();
    const bySlot = new Map<string, string[]>(scene.slots.map((s) => [s.id, []]));
    const introduced = new Set<string>();

    const renderQueue = (): void => {
      d3.select(queueEl)
        .selectAll<HTMLSpanElement, string>('.concept-viz-queue-item')
        .data(allTokens, (d) => d)
        .join('span')
        .attr(
          'class',
          (d) => `concept-viz-queue-item${introduced.has(d) ? ' concept-viz-queue-item--consumed' : ''}`,
        )
        .text((d) => d);
    };

    const renderSlots = (): void => {
      scene.slots.forEach((slot) => {
        const tokens = bySlot.get(slot.id) ?? [];
        const slotSel = d3.select(slotEls.get(slot.id)!);
        slotSel.classed('concept-viz-slot--collision', tokens.length > 1);

        slotSel
          .selectAll<HTMLSpanElement, string>('.concept-viz-token')
          .data(tokens, (d) => d)
          .join(
            (enter) =>
              enter
                .append('span')
                .attr('class', 'concept-viz-token')
                .text((d) => d)
                .style('opacity', 0)
                .style('transform', 'translateY(-10px) scale(0.7)')
                .transition()
                .duration(TRANSITION_MS)
                .style('opacity', 1)
                .style('transform', 'translateY(0) scale(1)'),
            (update) => update,
            (exit) =>
              exit
                .transition()
                .duration(TRANSITION_MS)
                .style('opacity', 0)
                .style('transform', 'translateY(10px) scale(0.7)')
                .remove(),
          );
      });
    };

    renderQueue();
    renderSlots();

    scene.steps.forEach((step, i) => {
      const timer = setTimeout(() => {
        if (step.place) {
          bySlot.get(step.place.slot)?.push(step.place.token);
          tokenSlot.set(step.place.token, step.place.slot);
          introduced.add(step.place.token);
        }
        if (step.move) {
          const from = tokenSlot.get(step.move.token);
          const fromTokens = from && bySlot.get(from);
          if (fromTokens) bySlot.set(from!, fromTokens.filter((t) => t !== step.move!.token));
          bySlot.get(step.move.toSlot)?.push(step.move.token);
          tokenSlot.set(step.move.token, step.move.toSlot);
        }
        if (step.remove) {
          const from = tokenSlot.get(step.remove.token);
          const fromTokens = from && bySlot.get(from);
          if (fromTokens) bySlot.set(from!, fromTokens.filter((t) => t !== step.remove!.token));
          tokenSlot.delete(step.remove.token);
        }
        if (step.highlight) {
          const slotEl = slotEls.get(step.highlight.slot);
          if (slotEl) {
            d3.select(slotEl).classed('concept-viz-slot--flash', true);
            setTimeout(() => d3.select(slotEl).classed('concept-viz-slot--flash', false), TRANSITION_MS * 2);
          }
        }

        renderQueue();
        renderSlots();
        caption.textContent = step.caption;

        if (i === scene.steps.length - 1) {
          timers.push(
            setTimeout(() => {
              caption.textContent = 'Done — click Replay to run it again.';
            }, STEP_DELAY_MS),
          );
        }
      }, i * STEP_DELAY_MS);
      timers.push(timer);
    });
  };

  d3.select(replayBtn).on('click', () => run());

  run();

  return () => {
    timers.forEach(clearTimeout);
  };
}
