import { describe, it, expect } from 'vitest';
import { interleaveByModule } from '../src/review/interleave';

interface Item {
  module: string;
  slug: string;
}

const item = (module: string, slug: string): Item => ({ module, slug });

describe('interleaveByModule (pure, synthetic data)', () => {
  it('returns an empty list unchanged', () => {
    expect(interleaveByModule([])).toEqual([]);
  });

  it('leaves a single module untouched', () => {
    const items = [item('java-concepts', 'a'), item('java-concepts', 'b'), item('java-concepts', 'c')];
    expect(interleaveByModule(items)).toEqual(items);
  });

  it('round-robins across modules in first-appearance order', () => {
    const a1 = item('java-concepts', 'a1');
    const a2 = item('java-concepts', 'a2');
    const a3 = item('java-concepts', 'a3');
    const b1 = item('spring-concepts', 'b1');
    const c1 = item('testing-concepts', 'c1');
    const c2 = item('testing-concepts', 'c2');

    // Input already sorted by dueAt ascending, as the caller (getDueQueue) produces it.
    const items = [a1, a2, a3, b1, c1, c2];

    expect(interleaveByModule(items)).toEqual([a1, b1, c1, a2, c2, a3]);
  });

  it('preserves each module\'s internal (most-overdue-first) order', () => {
    const aOld = item('java-concepts', 'old');
    const aNew = item('java-concepts', 'new');
    const b = item('spring-concepts', 'b');

    const result = interleaveByModule([aOld, aNew, b]);
    const aIndexOld = result.indexOf(aOld);
    const aIndexNew = result.indexOf(aNew);
    expect(aIndexOld).toBeLessThan(aIndexNew);
  });

  it('keeps the module with the most overdue item first overall', () => {
    const mostOverdue = item('jvm-concepts', 'x');
    const rest = item('java-concepts', 'y');
    expect(interleaveByModule([mostOverdue, rest])[0]).toBe(mostOverdue);
  });
});
