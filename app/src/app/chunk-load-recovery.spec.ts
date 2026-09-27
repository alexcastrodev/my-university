import { isChunkLoadError } from './chunk-load-recovery';
import { resolveAgainstBase } from './services/chunk-reload.service';

describe('isChunkLoadError', () => {
  it('recognises the Chrome and Firefox messages, which name the chunk', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/pt-BR/chunk-AB12.js'))).toBeTrue();
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/chunk-AB12.js'))).toBeTrue();
  });

  it("recognises Safari's message, which names no URL at all", () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBeTrue();
  });

  it('leaves unrelated errors alone', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBeFalse();
  });
});

describe('resolveAgainstBase', () => {
  it("keeps the locale's base href the router URL leaves out", () => {
    const base = document.createElement('base');
    base.href = '/pt-BR/';
    document.head.prepend(base);
    try {
      expect(resolveAgainstBase('/computer-science')).toBe(`${location.origin}/pt-BR/computer-science`);
    } finally {
      base.remove();
    }
  });
});
