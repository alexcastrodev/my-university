import { failureOf } from './pdf-engine';

const named = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('failureOf', () => {
  it('tells a password protected file from a broken one', () => {
    expect(failureOf(named('PasswordException'))).toBe('encrypted');
    expect(failureOf(named('InvalidPDFException'))).toBe('corrupt');
    expect(failureOf(named('FormatError'))).toBe('corrupt');
  });

  it('names running out of memory, so the reader can say the file is too big for this device', () => {
    expect(failureOf(new RangeError('Array buffer allocation failed'))).toBe('memory');
    expect(failureOf(new Error('Out of memory'))).toBe('memory');
  });

  it('falls back to a plain failure for anything else, including nothing at all', () => {
    expect(failureOf(new Error('boom'))).toBe('failed');
    expect(failureOf(null)).toBe('failed');
    expect(failureOf(undefined)).toBe('failed');
  });
});
