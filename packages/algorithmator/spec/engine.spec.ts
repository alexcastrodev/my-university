import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountViz } from '../src/engine';
import { VizScene } from '../src/types';

const STEP_DELAY_MS = 1300;

describe('mountViz — grid layout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Let any D3 transition left mid-flight by this test fully finish (and unregister itself
    // from d3-timer's internal, module-global timer queue) before switching timer modes —
    // otherwise a still-pending transition carries stale timer state into the next test.
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  const gridScene: VizScene = {
    meta: 'Capacity: 2',
    slots: [{ id: '0', label: '0' }, { id: '1', label: '1' }],
    steps: [
      { caption: '"a" → slot 0', place: { token: 'a', slot: '0' } },
      { caption: '"b" collides in slot 0', place: { token: 'b', slot: '0' } },
    ],
  };

  it('renders one .concept-viz-slot per declared slot', () => {
    const el = document.createElement('div');
    mountViz(el, gridScene);
    expect(el.querySelectorAll('.concept-viz-slot')).toHaveLength(2);
  });

  it('places a token into its slot as playback advances', () => {
    const el = document.createElement('div');
    mountViz(el, gridScene);
    vi.advanceTimersByTime(STEP_DELAY_MS);
    const slot0 = el.querySelectorAll('.concept-viz-slot')[0];
    expect(slot0.querySelectorAll('.concept-viz-token')).toHaveLength(1);
    expect(slot0.querySelector('.concept-viz-token')?.textContent).toBe('a');
  });

  it('flags a slot as a collision once it holds 2+ tokens', () => {
    const el = document.createElement('div');
    mountViz(el, gridScene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 2); // place "a" then "b", both into slot 0
    const slot0 = el.querySelectorAll('.concept-viz-slot')[0];
    expect(slot0.classList.contains('concept-viz-slot--collision')).toBe(true);
    expect(slot0.querySelectorAll('.concept-viz-token')).toHaveLength(2);
  });

  it('renders the queue with unconsumed tokens marked distinctly from consumed ones', () => {
    const el = document.createElement('div');
    mountViz(el, gridScene);
    const queueItemsBefore = el.querySelectorAll('.concept-viz-queue-item');
    expect(queueItemsBefore).toHaveLength(2); // both tokens known up front

    vi.advanceTimersByTime(STEP_DELAY_MS); // consume "a"
    const consumed = el.querySelectorAll('.concept-viz-queue-item--consumed');
    expect(consumed).toHaveLength(1);
    expect(consumed[0].textContent).toBe('a');
  });

  it('the returned cleanup function stops the autoplay timers', () => {
    const el = document.createElement('div');
    const cleanup = mountViz(el, gridScene);
    cleanup();
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    // Nothing should have been placed — the timers never fired after cleanup.
    expect(el.querySelectorAll('.concept-viz-token')).toHaveLength(0);
  });
});

describe('mountViz — row layout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Let any D3 transition left mid-flight by this test fully finish (and unregister itself
    // from d3-timer's internal, module-global timer queue) before switching timer modes —
    // otherwise a still-pending transition carries stale timer state into the next test.
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
  });

  const rowScene: VizScene = {
    meta: '3 elements',
    layout: 'row',
    slots: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2' }],
    steps: [
      { caption: 'Initial: a[0] = "x"', place: { token: 'x', slot: '0' } },
      { caption: 'Initial: a[1] = "y"', place: { token: 'y', slot: '1' } },
      { caption: 'Initial: a[2] = "z"', place: { token: 'z', slot: '2' } },
      { caption: 'Swap a[0] and a[2]', swap: { tokenA: 'x', tokenB: 'z' } },
    ],
  };

  it('renders row cells instead of grid slots, and no queue', () => {
    const el = document.createElement('div');
    mountViz(el, rowScene);
    expect(el.querySelectorAll('.concept-viz-cell')).toHaveLength(3);
    expect(el.querySelector('.concept-viz-slots--row')).not.toBeNull();
    expect(el.querySelector('.concept-viz-queue')).toBeNull();
  });

  it('renders one persistent token element per item, all present after the initial placements', () => {
    const el = document.createElement('div');
    mountViz(el, rowScene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3); // all 3 initial placements
    expect(el.querySelectorAll('.concept-viz-row-token')).toHaveLength(3);
  });

  it('a swap step highlights both exchanged tokens with the pointer class', () => {
    const el = document.createElement('div');
    mountViz(el, rowScene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 4); // 3 placements + the swap
    const pointerTokens = el.querySelectorAll('.concept-viz-row-token.concept-viz-slot--pointer');
    const labels = Array.from(pointerTokens).map((t) => t.textContent).sort();
    expect(labels).toEqual(['x', 'z']);
  });

  it('a mark (highlight) step flags the token currently in that slot as the pivot', () => {
    const scene: VizScene = {
      layout: 'row',
      slots: [{ id: '0', label: '0' }, { id: '1', label: '1' }],
      steps: [
        { caption: 'Initial: a[0] = "p"', place: { token: 'p', slot: '0' } },
        { caption: 'Initial: a[1] = "q"', place: { token: 'q', slot: '1' } },
        { caption: 'Mark a[0]', highlight: { slot: '0' } },
      ],
    };
    const el = document.createElement('div');
    mountViz(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);
    const flashed = el.querySelectorAll('.concept-viz-row-token.concept-viz-slot--flash');
    expect(flashed).toHaveLength(1);
    expect(flashed[0].textContent).toBe('p');
  });

  it('the pivot highlight persists across later unrelated steps, until a new mark or the pivot is swapped', () => {
    const scene: VizScene = {
      layout: 'row',
      slots: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2' }],
      steps: [
        { caption: 'Initial: a[0] = "p"', place: { token: 'p', slot: '0' } },
        { caption: 'Initial: a[1] = "q"', place: { token: 'q', slot: '1' } },
        { caption: 'Initial: a[2] = "r"', place: { token: 'r', slot: '2' } },
        { caption: 'Mark a[0]', highlight: { slot: '0' } },
        { caption: 'Swap a[1] and a[2]', swap: { tokenA: 'q', tokenB: 'r' } },
      ],
    };
    const el = document.createElement('div');
    mountViz(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    // "p" (the pivot, marked earlier) should still show the flash class even though the most
    // recent step was an unrelated swap between "q" and "r".
    const flashed = el.querySelectorAll('.concept-viz-row-token.concept-viz-slot--flash');
    expect(flashed).toHaveLength(1);
    expect(flashed[0].textContent).toBe('p');
  });

  it('a move step slides an existing token to its new slot', () => {
    const scene: VizScene = {
      layout: 'row',
      slots: [{ id: '0', label: '0' }, { id: '1', label: '1' }, { id: '2', label: '2' }],
      steps: [
        { caption: 'Initial: a[0] = "p"', place: { token: 'p', slot: '0' } },
        { caption: 'Initial: a[1] = "q"', place: { token: 'q', slot: '1' } },
        { caption: 'Move p to slot 2', move: { token: 'p', toSlot: '2' } },
      ],
    };
    const el = document.createElement('div');
    mountViz(el, scene);
    vi.advanceTimersByTime(STEP_DELAY_MS * 3 + 500);

    const tokens = Array.from(el.querySelectorAll('.concept-viz-row-token'));
    const p = tokens.find((t) => t.textContent === 'p') as HTMLElement;
    // Slot "2" is index 2 in scene.slots, so its target x is 2 * (CELL_WIDTH + CELL_GAP) = 124px.
    // D3's CSS transform interpolator doesn't always re-serialize every function it started
    // with (e.g. a trailing `scale(1)` may be dropped once the transition settles), so parse
    // out just the translate x rather than asserting the full string.
    expect(p.style.transform).toMatch(/^translate\(124px,\s*0px\)/);
  });

  it('a remove step fades an existing token out and detaches it once the transition finishes', () => {
    const scene: VizScene = {
      layout: 'row',
      slots: [{ id: '0', label: '0' }, { id: '1', label: '1' }],
      steps: [
        { caption: 'Initial: a[0] = "p"', place: { token: 'p', slot: '0' } },
        { caption: 'Initial: a[1] = "q"', place: { token: 'q', slot: '1' } },
        { caption: 'Remove p', remove: { token: 'p' } },
      ],
    };
    const el = document.createElement('div');
    mountViz(el, scene);
    // The removed token's DOM element is only detached once its exit transition (TRANSITION_MS)
    // finishes, which only starts when the "remove" step's own timer fires — so budget extra
    // time beyond the 3 steps themselves for that transition to actually complete.
    vi.advanceTimersByTime(STEP_DELAY_MS * 3 + 500);

    const tokens = Array.from(el.querySelectorAll('.concept-viz-row-token'));
    expect(tokens.map((t) => t.textContent)).toEqual(['q']);
  });

  it('the returned cleanup function stops the autoplay timers', () => {
    const el = document.createElement('div');
    const cleanup = mountViz(el, rowScene);
    cleanup();
    vi.advanceTimersByTime(STEP_DELAY_MS * 10);
    expect(el.querySelectorAll('.concept-viz-row-token')).toHaveLength(0);
  });
});
