/**
 * The shelf's CSS, injected once as a <style> element. Colours come from `--bs-*` variables with a
 * fallback, so the host page can theme it without touching this file.
 */
export const CSS = `
.book-shelf { display: flex; flex-direction: column; gap: 28px; width: 100%; --bs-ease: cubic-bezier(0.22, 1, 0.36, 1); }
.book-shelf .shelf { position: relative; }
.book-shelf .shelf-row { display: flex; align-items: flex-end; gap: 3px; }
.book-shelf .shelf-board { height: 10px; background: var(--bs-board, #ecebe6); border-top: 1px solid var(--bs-board-edge, #dddcd5); box-shadow: 0 14px 24px -14px rgba(0, 0, 0, 0.18); }
.book-shelf .shelf-detail { min-height: 0; text-align: center; padding: 0 12px; }
.book-shelf .shelf-detail:not(:empty) { padding-top: 20px; }
.book-shelf .shelf-detail-title { margin: 0 0 4px; font-size: 18px; font-weight: 600; letter-spacing: -0.02em; color: var(--bs-ink, inherit); overflow-wrap: anywhere; }
.book-shelf .shelf-detail-title a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
.book-shelf .shelf-detail-meta { margin: 0; font-size: 13px; color: var(--bs-muted, #6b6b6b); }

.book-shelf .sb-slot { position: relative; flex: none; padding: 0; border: 0; background: none; cursor: pointer; perspective: 1400px; transition: width 0.6s var(--bs-ease); }
.book-shelf .sb-slot:focus-visible { outline: none; }
.book-shelf .sb-slot:focus-visible .sb-spine { outline: 2px solid var(--bs-focus, #2563eb); outline-offset: 3px; }
.book-shelf .sb-book { position: absolute; bottom: 0; left: 50%; width: var(--w); height: var(--h); margin-left: calc(var(--w) / -2); transform-style: preserve-3d; transform: rotateY(90deg); transition: transform 0.6s var(--bs-ease); }
.book-shelf .sb-slot:hover .sb-book { transform: translateY(-10px) rotateY(90deg); }
.book-shelf .sb-slot.is-open .sb-book { transform: translateY(-8px) translateZ(36px) rotateY(16deg); }
.book-shelf .sb-book > span { position: absolute; box-sizing: border-box; }

.book-shelf .sb-front { inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 18px 16px; text-align: left; transform: translateZ(calc(var(--d) / 2)); overflow: hidden; box-shadow: inset 6px 0 rgba(0, 0, 0, 0.1), 0 20px 40px -20px rgba(0, 0, 0, 0.35); }
.book-shelf .sb-front-title { font-size: 18px; font-weight: 500; line-height: 1.08; letter-spacing: -0.025em; overflow-wrap: anywhere; }
.book-shelf .sb-front.has-cover .sb-front-title { visibility: hidden; }
.book-shelf .sb-cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

.book-shelf .sb-spine { top: 0; left: calc((var(--w) - var(--d)) / 2); width: var(--d); height: var(--h); display: flex; flex-direction: column; justify-content: space-between; align-items: center; padding: 10px 0 12px; transform: rotateY(-90deg) translateZ(calc(var(--w) / 2)); box-shadow: inset 2px 0 rgba(255, 255, 255, 0.12), inset -3px 0 rgba(0, 0, 0, 0.12); }
.book-shelf .sb-band { width: 100%; height: 2px; opacity: 0.35; background: currentColor; }
.book-shelf .sb-spine-title { max-height: calc(var(--h) - 48px); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 11px; font-weight: 500; letter-spacing: 0.01em; writing-mode: vertical-rl; transform: rotate(180deg); }
.book-shelf .sb-spine-dot { width: 5px; height: 5px; border-radius: 50%; opacity: 0.6; background: currentColor; }

.book-shelf .sb-pages { top: 2px; left: calc((var(--w) - var(--d)) / 2); width: var(--d); height: calc(var(--h) - 4px); transform: rotateY(90deg) translateZ(calc(var(--w) / 2 - 2px)); background: repeating-linear-gradient(90deg, #fff 0 2px, #e6e5e0 2px 3px); }
.book-shelf .sb-top { left: 0; top: calc((var(--h) - var(--d)) / 2); width: calc(var(--w) - 2px); height: var(--d); transform: rotateX(90deg) translateZ(calc(var(--h) / 2 - 1px)); background: #f2f1ec; }

@media (prefers-reduced-motion: reduce) {
  .book-shelf .sb-slot, .book-shelf .sb-book { transition: none; }
}
`;
