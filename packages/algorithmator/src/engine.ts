import * as d3 from 'd3';
import { VizScene, VizStep } from './types';

const STEP_DELAY_MS = 900;
const TRANSITION_MS = 300;

/**
 * Renders `scene.slots` once, then plays `scene.steps` into `el` — autoplaying from the start,
 * with Prev/Next/Play-Pause/Replay controls so a reader can take over and step through by hand
 * at their own pace. Every navigation (forward, backward, or reset) replays scene.steps[0..target]
 * from an empty state and re-runs the same D3 enter/update/exit join; D3's keyed data join means
 * tokens that stay put across a replay are recognized as "update" (no re-animation), so only
 * genuinely new/moved/removed tokens animate — no bespoke undo logic needed per step type.
 * Framework-agnostic — pass any HTMLElement you own.
 *
 * Returns a cleanup function that cancels any pending timers.
 */
export function mountViz(el: HTMLElement, scene: VizScene): () => void {
  el.innerHTML = '';
  el.classList.add('concept-viz-root');

  const header = document.createElement('div');
  header.className = 'concept-viz-header';
  header.innerHTML = `<span>${scene.meta ?? ''}</span>`;
  el.appendChild(header);

  const controls = document.createElement('div');
  controls.className = 'concept-viz-controls';
  header.appendChild(controls);

  const makeButton = (label: string, ariaLabel: string): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'concept-viz-btn';
    btn.textContent = label;
    btn.setAttribute('aria-label', ariaLabel);
    btn.title = ariaLabel;
    controls.appendChild(btn);
    return btn;
  };

  const prevBtn = makeButton('⏮', 'Previous step');
  const playPauseBtn = makeButton('▶', 'Play');
  const nextBtn = makeButton('⏭', 'Next step');
  const replayBtn = makeButton('↻', 'Restart');

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
  const lastIndex = scene.steps.length - 1;

  const renderQueue = (introduced: Set<string>): void => {
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

  const renderSlots = (bySlot: Map<string, string[]>): void => {
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

  const flashSlot = (slotId: string): void => {
    const slotEl = slotEls.get(slotId);
    if (!slotEl) return;
    d3.select(slotEl).classed('concept-viz-slot--flash', true);
    setTimeout(() => d3.select(slotEl).classed('concept-viz-slot--flash', false), TRANSITION_MS * 2);
  };

  const applyStep = (
    step: VizStep,
    bySlot: Map<string, string[]>,
    tokenSlot: Map<string, string>,
    introduced: Set<string>,
  ): void => {
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
  };

  let stepIndex = -1;
  let lastRenderedIndex = -1;
  let isPlaying = false;
  let playTimer: ReturnType<typeof setTimeout> | undefined;
  let doneTimer: ReturnType<typeof setTimeout> | undefined;

  const updateButtons = (): void => {
    prevBtn.toggleAttribute('disabled', stepIndex <= -1);
    nextBtn.toggleAttribute('disabled', stepIndex >= lastIndex);
    playPauseBtn.toggleAttribute('disabled', stepIndex >= lastIndex && !isPlaying);
    playPauseBtn.textContent = isPlaying ? '⏸' : '▶';
    playPauseBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
    playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
  };

  // Every navigation replays scene.steps[0..target] from scratch — see the function doc comment
  // above for why this is safe and cheap for the small step counts these visualizations have.
  const renderAt = (target: number): void => {
    if (doneTimer) clearTimeout(doneTimer);

    const bySlot = new Map<string, string[]>(scene.slots.map((s) => [s.id, []]));
    const tokenSlot = new Map<string, string>();
    const introduced = new Set<string>();
    for (let i = 0; i <= target; i++) applyStep(scene.steps[i], bySlot, tokenSlot, introduced);

    renderQueue(introduced);
    renderSlots(bySlot);
    caption.textContent = target === -1 ? '' : scene.steps[target].caption;

    if (target > lastRenderedIndex && target >= 0 && scene.steps[target].highlight) {
      flashSlot(scene.steps[target].highlight!.slot);
    }
    lastRenderedIndex = target;

    if (target === lastIndex) {
      doneTimer = setTimeout(() => {
        caption.textContent = 'Done — click Replay to run it again.';
      }, STEP_DELAY_MS);
    }

    updateButtons();
  };

  const pause = (): void => {
    isPlaying = false;
    if (playTimer) clearTimeout(playTimer);
  };

  const scheduleNext = (): void => {
    playTimer = setTimeout(() => {
      stepIndex++;
      renderAt(stepIndex);
      if (stepIndex >= lastIndex) {
        isPlaying = false;
        updateButtons();
        return;
      }
      scheduleNext();
    }, STEP_DELAY_MS);
  };

  const play = (): void => {
    if (stepIndex >= lastIndex) return;
    isPlaying = true;
    updateButtons();
    scheduleNext();
  };

  prevBtn.addEventListener('click', () => {
    pause();
    if (stepIndex <= -1) return;
    stepIndex--;
    renderAt(stepIndex);
  });

  nextBtn.addEventListener('click', () => {
    pause();
    if (stepIndex >= lastIndex) return;
    stepIndex++;
    renderAt(stepIndex);
  });

  playPauseBtn.addEventListener('click', () => {
    if (isPlaying) pause();
    else play();
    updateButtons();
  });

  replayBtn.addEventListener('click', () => {
    pause();
    stepIndex = -1;
    lastRenderedIndex = -1;
    renderAt(-1);
    play();
  });

  renderAt(-1);
  play();

  return () => {
    pause();
    if (doneTimer) clearTimeout(doneTimer);
  };
}
