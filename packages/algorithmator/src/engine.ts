import * as d3 from 'd3';
import { VizScene, VizStep } from './types';

const STEP_DELAY_MS = 1300;
const TRANSITION_MS = 380;

// Row-layout geometry — kept in sync with the `--cv-cell-*` custom properties consumers set in
// their `.concept-viz-slots--row` CSS (see algorithms-concept-view.css). Hardcoded rather than
// read from the DOM because this is an internal rendering detail, not something content authors
// configure per scene.
const CELL_WIDTH = 52;
const CELL_HEIGHT = 78; // container height: a 52px token box + gap + its index label beneath
const CELL_GAP = 10;
const CELL_STEP = CELL_WIDTH + CELL_GAP;

/**
 * Renders `scene.slots` once, then plays `scene.steps` into `el` — autoplaying from the start,
 * with Prev/Next/Play-Pause/Replay controls so a reader can take over and step through by hand
 * at their own pace. Every navigation (forward, backward, or reset) replays scene.steps[0..target]
 * from an empty state and re-derives the slot/token layout that state implies; only the *delta*
 * against what's currently on screen actually animates (see renderGridSlots/renderRowTokens),
 * so intermediate replayed steps never themselves animate — only the target step's effect does.
 * Framework-agnostic — pass any HTMLElement you own.
 *
 * Returns a cleanup function that cancels any pending timers.
 */
export function mountViz(el: HTMLElement, scene: VizScene): () => void {
  const isRow = scene.layout === 'row';

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
  // Row-mode scenes place every item up front (it's a fixed-size array being reordered, not
  // items arriving over time), so the "still to arrive" queue doesn't mean anything there.
  if (!isRow) el.appendChild(queueEl);

  const slotsEl = document.createElement('div');
  slotsEl.className = isRow ? 'concept-viz-slots concept-viz-slots--row' : 'concept-viz-slots';
  el.appendChild(slotsEl);

  const caption = document.createElement('div');
  caption.className = 'concept-viz-caption';
  el.appendChild(caption);

  const slotEls = new Map<string, HTMLElement>();
  const slotIndexOf = new Map(scene.slots.map((s, i) => [s.id, i]));

  if (isRow) {
    slotsEl.style.width = `${scene.slots.length * CELL_STEP - CELL_GAP}px`;
    slotsEl.style.height = `${CELL_HEIGHT}px`;
    scene.slots.forEach((slot, index) => {
      const cellEl = document.createElement('div');
      cellEl.className = 'concept-viz-cell';
      cellEl.style.left = `${index * CELL_STEP}px`;
      cellEl.innerHTML = `<span class="concept-viz-cell-label">${slot.label}</span>`;
      slotsEl.appendChild(cellEl);
      slotEls.set(slot.id, cellEl);
    });
  } else {
    scene.slots.forEach((slot) => {
      const slotEl = document.createElement('div');
      slotEl.className = 'concept-viz-slot';
      slotEl.innerHTML = `<span class="concept-viz-slot-label">${slot.label}</span>`;
      slotsEl.appendChild(slotEl);
      slotEls.set(slot.id, slotEl);
    });
  }

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

  const renderGridSlots = (bySlot: Map<string, string[]>): void => {
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

  // Row mode: one persistent DOM element per token, positioned absolutely within `slotsEl` and
  // moved via `transform: translate(x, y)`. Unlike grid mode's per-slot D3 join (which can only
  // fade a token out of one slot's container and fade a *different* element into another slot's
  // container), a token here is the *same* element throughout its life — animating its transform
  // is a real, visible slide from its old position to its new one, not a cross-dissolve.
  const rowTokenEls = new Map<string, HTMLElement>();

  const renderRowTokens = (bySlot: Map<string, string[]>, swappedTokens: ReadonlySet<string>): void => {
    const activeTokenSlot = new Map<string, string>();
    bySlot.forEach((tokens, slotId) => tokens.forEach((t) => activeTokenSlot.set(t, slotId)));

    for (const [token, tokenEl] of [...rowTokenEls]) {
      if (activeTokenSlot.has(token)) continue;
      d3.select(tokenEl)
        .transition()
        .duration(TRANSITION_MS)
        .style('opacity', '0')
        .on('end', () => tokenEl.remove());
      rowTokenEls.delete(token);
    }

    activeTokenSlot.forEach((slotId, token) => {
      const x = (slotIndexOf.get(slotId) ?? 0) * CELL_STEP;
      let tokenEl = rowTokenEls.get(token);

      if (!tokenEl) {
        tokenEl = document.createElement('div');
        tokenEl.className = 'concept-viz-row-token';
        tokenEl.textContent = token;
        tokenEl.style.transform = `translate(${x}px, 0px) scale(0.7)`;
        tokenEl.style.opacity = '0';
        slotsEl.appendChild(tokenEl);
        rowTokenEls.set(token, tokenEl);
        requestAnimationFrame(() => {
          d3.select(tokenEl!)
            .transition()
            .duration(TRANSITION_MS)
            .style('opacity', '1')
            .style('transform', `translate(${x}px, 0px) scale(1)`);
        });
        return;
      }

      const targetTransform = `translate(${x}px, 0px) scale(1)`;
      if (tokenEl.style.transform === targetTransform) return; // unchanged this step — no re-animation

      if (swappedTokens.has(token)) {
        // A little hop (lift, slide, settle) so two elements trading places read as a swap
        // instead of two independent slides that happen to cross.
        d3.select(tokenEl)
          .transition()
          .duration(TRANSITION_MS * 0.55)
          .style('transform', `translate(${x}px, -16px) scale(1.08)`)
          .transition()
          .duration(TRANSITION_MS * 0.45)
          .style('transform', targetTransform);
      } else {
        d3.select(tokenEl).transition().duration(TRANSITION_MS).style('transform', targetTransform);
      }
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
    if (step.swap) {
      const { tokenA, tokenB } = step.swap;
      const slotA = tokenSlot.get(tokenA);
      const slotB = tokenSlot.get(tokenB);
      if (slotA && slotB && slotA !== slotB) {
        const tokensA = bySlot.get(slotA);
        const tokensB = bySlot.get(slotB);
        if (tokensA) bySlot.set(slotA, tokensA.filter((t) => t !== tokenA));
        if (tokensB) bySlot.set(slotB, tokensB.filter((t) => t !== tokenB));
        bySlot.get(slotB)?.push(tokenA);
        bySlot.get(slotA)?.push(tokenB);
        tokenSlot.set(tokenA, slotB);
        tokenSlot.set(tokenB, slotA);
      }
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

  const renderAt = (target: number): void => {
    if (doneTimer) clearTimeout(doneTimer);

    const bySlot = new Map<string, string[]>(scene.slots.map((s) => [s.id, []]));
    const tokenSlot = new Map<string, string>();
    const introduced = new Set<string>();
    for (let i = 0; i <= target; i++) applyStep(scene.steps[i], bySlot, tokenSlot, introduced);

    if (isRow) {
      const targetStep = target >= 0 ? scene.steps[target] : null;
      const swappedTokens = targetStep?.swap ? new Set([targetStep.swap.tokenA, targetStep.swap.tokenB]) : new Set<string>();
      renderRowTokens(bySlot, swappedTokens);
    } else {
      renderQueue(introduced);
      renderGridSlots(bySlot);
    }
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
