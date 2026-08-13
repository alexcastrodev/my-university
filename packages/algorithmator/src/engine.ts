import * as d3 from 'd3';
import { mountStepper } from './stepper';
import { VizScene, VizStep } from './types';

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
 * with Prev/Next/Play-Pause/Replay controls (via stepper.ts) so a reader can take over and step
 * through by hand at their own pace. Every navigation (forward, backward, or reset) replays
 * scene.steps[0..target] from an empty state and re-derives the slot/token layout that state
 * implies; only the *delta* against what's currently on screen actually animates (see
 * renderGridSlots/renderRowTokens), so intermediate replayed steps never themselves animate —
 * only the target step's effect does. Framework-agnostic — pass any HTMLElement you own.
 *
 * Returns a cleanup function that cancels any pending timers.
 */
export function mountViz(el: HTMLElement, scene: VizScene): () => void {
  const isRow = scene.layout === 'row';

  el.innerHTML = '';
  el.classList.add('concept-viz-root');

  const queueEl = document.createElement('div');
  queueEl.className = 'concept-viz-queue';
  // Row-mode scenes place every item up front (it's a fixed-size array being reordered, not
  // items arriving over time), so the "still to arrive" queue doesn't mean anything there.

  const slotsEl = document.createElement('div');
  slotsEl.className = isRow ? 'concept-viz-slots concept-viz-slots--row' : 'concept-viz-slots';

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
          .style('opacity', '1')
          .style('transform', `translate(${x}px, -16px) scale(1.08)`)
          .transition()
          .duration(TRANSITION_MS * 0.45)
          .style('transform', targetTransform);
      } else {
        // `.style('opacity', '1')` here isn't just for the move itself — if this call lands
        // while the token's entrance fade (opacity 0→1) is still in flight, starting this
        // transition interrupts that one. Without re-asserting opacity, the interrupted fade
        // freezes at whatever partial value it had reached, leaving the token stuck translucent.
        d3.select(tokenEl)
          .transition()
          .duration(TRANSITION_MS)
          .style('opacity', '1')
          .style('transform', targetTransform);
      }
    });
  };

  // Two different kinds of "this cell matters right now" exist: a pivot pick (`--flash`, violet)
  // and the pair of positions a swap is currently exchanging (`--pointer`, blue). They're kept as
  // separate classes so a reader can tell "the pivot" from "what's being compared/exchanged right
  // now" at a glance, rather than one flash color meaning both.
  //
  // The highlight is derived fresh from whichever step is on screen, not faded out on a timer —
  // an earlier timer-based version raced itself (a later mark's highlight could get wiped by an
  // earlier mark's stale removal timer) and, even fixed, still faded mid-step whenever a reader
  // paused to look rather than clicking through at a steady pace. Deriving it from the current
  // step means it's simply correct for however long that step stays on screen, including when
  // stepping backward (which a timer keyed to "just flashed" could never support).
  // Keyed by token in row mode (highlighting the visible letter itself — see below) or by slot id
  // in grid mode.
  let activeHighlights = new Map<string, string>();

  // `pivotSlot` is the slot named by the most recent `mark` at or before the current step — the
  // pivot stays "the pivot" (violet) across every step in between, not just the single step it
  // was marked on, since unrelated swaps can happen around it before it's finally placed.
  const syncHighlights = (targetStep: VizStep | null, tokenSlot: Map<string, string>, pivotSlot: string | undefined): void => {
    const nextHighlights = new Map<string, string>();

    if (isRow) {
      // In row mode the letter box (`.concept-viz-row-token`) is an opaque, absolutely-positioned
      // element sitting exactly on top of its placeholder cell — coloring the cell underneath (as
      // grid mode does) would be completely invisible, hidden by the token itself. So here the
      // highlight targets the token elements directly, keyed by token rather than by slot.
      if (pivotSlot) {
        for (const [token, slot] of tokenSlot) {
          if (slot === pivotSlot) {
            nextHighlights.set(token, 'concept-viz-slot--flash');
            break;
          }
        }
      }
      // Applied after the pivot lookup so that on the exact step where the pivot itself is one
      // of the two tokens being swapped (its placement into final position), the swap's blue
      // takes over from the pivot's violet for that step — a more specific, momentary signal.
      if (targetStep?.swap) {
        nextHighlights.set(targetStep.swap.tokenA, 'concept-viz-slot--pointer');
        nextHighlights.set(targetStep.swap.tokenB, 'concept-viz-slot--pointer');
      }
    } else if (targetStep?.highlight) {
      nextHighlights.set(targetStep.highlight.slot, 'concept-viz-slot--flash');
    }

    const elFor = (key: string): HTMLElement | undefined => (isRow ? rowTokenEls.get(key) : slotEls.get(key));

    activeHighlights.forEach((className, key) => {
      if (nextHighlights.get(key) === className) return;
      const el = elFor(key);
      if (el) d3.select(el).classed(className, false);
    });
    nextHighlights.forEach((className, key) => {
      const el = elFor(key);
      if (el) d3.select(el).classed(className, true);
    });
    activeHighlights = nextHighlights;
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

  const stepper = mountStepper(el, scene.meta, {
    totalSteps: scene.steps.length,
    captionFor: (index) => (index === -1 ? '' : scene.steps[index].caption),
    onStep: (target) => {
      const bySlot = new Map<string, string[]>(scene.slots.map((s) => [s.id, []]));
      const tokenSlot = new Map<string, string>();
      const introduced = new Set<string>();
      for (let i = 0; i <= target; i++) applyStep(scene.steps[i], bySlot, tokenSlot, introduced);

      const targetStep = target >= 0 ? scene.steps[target] : null;

      if (isRow) {
        const swappedTokens = targetStep?.swap
          ? new Set([targetStep.swap.tokenA, targetStep.swap.tokenB])
          : new Set<string>();
        renderRowTokens(bySlot, swappedTokens);
      } else {
        renderQueue(introduced);
        renderGridSlots(bySlot);
      }

      let pivotSlot: string | undefined;
      for (let i = target; i >= 0; i--) {
        if (scene.steps[i].highlight) {
          pivotSlot = scene.steps[i].highlight!.slot;
          break;
        }
      }
      syncHighlights(targetStep, tokenSlot, pivotSlot);
    },
  });

  el.appendChild(stepper.header);
  if (!isRow) el.appendChild(queueEl);
  el.appendChild(slotsEl);
  el.appendChild(stepper.caption);

  stepper.start();

  return () => stepper.destroy();
}
