// d3-timer also captures its time source ONCE at module-load time: `clock = performance` (a
// captured OBJECT reference, not a dynamic lookup). Vitest's fake timers may swap in a
// different `performance`/`Date` object per-test, which that frozen reference never sees, so
// elapsed-time math inside every D3 transition silently reads real (near-zero, since the test
// itself runs in a few real ms) wall-clock deltas instead of the advanced fake time. Overriding
// `.now` in place — rather than replacing the object — keeps d3-timer's captured reference
// valid: it delegates to the global `Date` identifier, which IS resolved dynamically per call
// and so always reflects whichever real/fake `Date` is currently installed.
if (typeof performance !== 'undefined') {
  performance.now = () => Date.now();
}

// d3-timer picks requestAnimationFrame vs setTimeout ONCE, at module-load time, by checking
// `window.requestAnimationFrame`, then caches a *bound reference* to whatever it finds.
// Vitest's fake timers are installed later (per-test, in beforeEach), so happy-dom's real RAF
// — which only fires on the real event loop — gets locked in, and every D3 transition silently
// never advances under `vi.useFakeTimers()`. engine.ts also calls `requestAnimationFrame`
// directly (to force a layout flush before starting a CSS transition), so it can't simply be
// removed. Replacing it with a shim that resolves `setTimeout` dynamically (per call, not
// captured) fixes both: d3-timer's cached reference still works, because the shim itself always
// reaches whatever `setTimeout` is currently installed — fake or real.
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback): number =>
  setTimeout(() => cb(Date.now()), 16) as unknown as number;
(globalThis as any).cancelAnimationFrame = (id: number): void => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

// happy-dom does not implement SVGTransformList#consolidate (used internally by
// d3-interpolate's SVG transform parser). Polyfill it by composing the list's own
// transform matrices — the same values happy-dom already parses per SVGTransform.
const transformListCtor = (globalThis as any).SVGTransformList as { prototype: any } | undefined;

if (transformListCtor && !transformListCtor.prototype.consolidate) {
  transformListCtor.prototype.consolidate = function (
    this: Iterable<{ matrix: { a: number; b: number; c: number; d: number; e: number; f: number } }>,
  ) {
    const items = Array.from(this);
    if (items.length === 0) return null;

    let acc = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    for (const item of items) {
      const m = item.matrix;
      acc = {
        a: acc.a * m.a + acc.c * m.b,
        b: acc.b * m.a + acc.d * m.b,
        c: acc.a * m.c + acc.c * m.d,
        d: acc.b * m.c + acc.d * m.d,
        e: acc.a * m.e + acc.c * m.f + acc.e,
        f: acc.b * m.e + acc.d * m.f + acc.f,
      };
    }
    return { matrix: acc };
  };
}
