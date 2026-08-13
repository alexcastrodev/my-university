const STEP_DELAY_MS = 1300;

export interface StepperHandlers {
  /** Number of steps (indices 0..totalSteps-1). Index -1 is the initial/empty state. */
  totalSteps: number;
  /** Caption text for a given step index (-1 for the initial state, before anything happened). */
  captionFor: (index: number) => string;
  /** Apply whatever visual change step `index` represents (-1 resets to the initial state). */
  onStep: (index: number) => void;
}

export interface Stepper {
  header: HTMLElement;
  caption: HTMLElement;
  /** Starts autoplay from the initial state. Call once, after mounting any scene-specific DOM. */
  start(): void;
  /** Cancels any pending timers. Call before discarding the element. */
  destroy(): void;
}

/**
 * Builds the header (meta + Prev/Play-Pause/Next/Replay controls) and caption bar shared by every
 * viz render mode (grid/row scenes in engine.ts, tree scenes, graph scenes), and owns the
 * step-index/play-state/timer bookkeeping. The caller supplies only what's specific to its scene
 * type: how many steps exist, what a step's caption is, and how to render one. This is pure
 * playback control — it holds no opinion about slots, tokens, nodes, or edges.
 */
export function mountStepper(el: HTMLElement, meta: string | undefined, handlers: StepperHandlers): Stepper {
  const header = document.createElement('div');
  header.className = 'concept-viz-header';
  header.innerHTML = `<span>${meta ?? ''}</span>`;

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

  const caption = document.createElement('div');
  caption.className = 'concept-viz-caption';

  const lastIndex = handlers.totalSteps - 1;
  let stepIndex = -1;
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
    handlers.onStep(target);
    caption.textContent = handlers.captionFor(target);
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
    renderAt(-1);
    play();
  });

  return {
    header,
    caption,
    start(): void {
      renderAt(-1);
      play();
    },
    destroy(): void {
      pause();
      if (doneTimer) clearTimeout(doneTimer);
    },
  };
}
