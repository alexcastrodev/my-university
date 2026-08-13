import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountStepper } from '../src/stepper';

const STEP_DELAY_MS = 1300;

function buttons(header: HTMLElement) {
  const [prev, playPause, next, replay] = Array.from(header.querySelectorAll('button'));
  return { prev, playPause, next, replay } as Record<string, HTMLButtonElement>;
}

describe('mountStepper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the meta text into the header', () => {
    const el = document.createElement('div');
    const stepper = mountStepper(el, 'Capacity: 8', { totalSteps: 1, captionFor: () => '', onStep: () => {} });
    expect(stepper.header.querySelector('span')?.textContent).toBe('Capacity: 8');
  });

  it('calls onStep(-1) and shows the initial caption immediately on start()', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, {
      totalSteps: 2,
      captionFor: (i) => (i === -1 ? 'ready' : `step ${i}`),
      onStep,
    });
    stepper.start();
    expect(onStep).toHaveBeenCalledWith(-1);
    expect(stepper.caption.textContent).toBe('ready');
  });

  it('autoplays forward one step per STEP_DELAY_MS after start()', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 3, captionFor: (i) => `c${i}`, onStep });
    stepper.start();
    onStep.mockClear();

    vi.advanceTimersByTime(STEP_DELAY_MS);
    expect(onStep).toHaveBeenCalledWith(0);
    expect(stepper.caption.textContent).toBe('c0');

    vi.advanceTimersByTime(STEP_DELAY_MS);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('disables Prev at the initial state and disables Next/Play at the last step', () => {
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 2, captionFor: () => '', onStep: () => {} });
    stepper.start();
    const { prev, next, playPause } = buttons(stepper.header);

    expect(prev.disabled).toBe(true);

    vi.advanceTimersByTime(STEP_DELAY_MS); // -> step 0
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);

    vi.advanceTimersByTime(STEP_DELAY_MS); // -> step 1 (last)
    expect(next.disabled).toBe(true);
    expect(playPause.disabled).toBe(true); // nothing left to play once stopped at the end
  });

  it('Next/Prev buttons pause autoplay and step manually, one step at a time', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 3, captionFor: (i) => `c${i}`, onStep });
    stepper.start();
    const { next, prev } = buttons(stepper.header);
    onStep.mockClear();

    next.click();
    expect(onStep).toHaveBeenCalledWith(0);

    // Autoplay should now be paused — advancing time must NOT trigger another step.
    onStep.mockClear();
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    expect(onStep).not.toHaveBeenCalled();

    next.click();
    expect(onStep).toHaveBeenCalledWith(1);

    prev.click();
    expect(onStep).toHaveBeenCalledWith(0);
  });

  it('Prev at the initial state and Next at the last step are no-ops', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 1, captionFor: (i) => `c${i}`, onStep });
    stepper.start();
    const { prev, next } = buttons(stepper.header);
    onStep.mockClear();

    prev.click(); // already at -1
    expect(onStep).not.toHaveBeenCalled();

    next.click(); // -> step 0 (the only/last step)
    expect(onStep).toHaveBeenCalledWith(0);
    onStep.mockClear();

    next.click(); // already at the last step
    expect(onStep).not.toHaveBeenCalled();
  });

  it('the Play/Pause button toggles autoplay on click', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 3, captionFor: (i) => `c${i}`, onStep });
    stepper.start();
    const { playPause } = buttons(stepper.header);

    playPause.click(); // pause
    onStep.mockClear();
    vi.advanceTimersByTime(STEP_DELAY_MS * 3);
    expect(onStep).not.toHaveBeenCalled();

    playPause.click(); // resume
    vi.advanceTimersByTime(STEP_DELAY_MS);
    expect(onStep).toHaveBeenCalledWith(0);
  });

  it('shows a "Done" message once STEP_DELAY_MS elapses after reaching the last step', () => {
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 1, captionFor: (i) => `c${i}`, onStep: () => {} });
    stepper.start();

    vi.advanceTimersByTime(STEP_DELAY_MS); // -> reaches the only (last) step
    expect(stepper.caption.textContent).toBe('c0');

    vi.advanceTimersByTime(STEP_DELAY_MS); // the "done" timer fires
    expect(stepper.caption.textContent).toBe('Done — click Replay to run it again.');
  });

  it('Replay resets to the initial state and restarts autoplay', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 2, captionFor: (i) => `c${i}`, onStep });
    stepper.start();
    vi.advanceTimersByTime(STEP_DELAY_MS * 2); // run to the end
    onStep.mockClear();

    const { replay } = buttons(stepper.header);
    replay.click();
    expect(onStep).toHaveBeenCalledWith(-1);

    onStep.mockClear();
    vi.advanceTimersByTime(STEP_DELAY_MS);
    expect(onStep).toHaveBeenCalledWith(0); // autoplay resumed on its own after replay
  });

  it('destroy() cancels pending timers so no further steps fire', () => {
    const onStep = vi.fn();
    const el = document.createElement('div');
    const stepper = mountStepper(el, undefined, { totalSteps: 3, captionFor: (i) => `c${i}`, onStep });
    stepper.start();
    onStep.mockClear();

    stepper.destroy();
    vi.advanceTimersByTime(STEP_DELAY_MS * 5);
    expect(onStep).not.toHaveBeenCalled();
  });
});
