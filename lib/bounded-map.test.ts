import { describe, it, expect } from 'vitest';
import { setBounded } from './bounded-map.js';

describe('setBounded', () => {
  it('evicts the oldest entries beyond max', () => {
    const m = new Map<string, number>();
    for (const [k, v] of [['a', 1], ['b', 2], ['c', 3]] as const) setBounded(m, k, v, 2);
    expect([...m.keys()]).toEqual(['b', 'c']);
  });

  it('re-setting a key refreshes its position', () => {
    const m = new Map<string, number>();
    setBounded(m, 'a', 1, 2);
    setBounded(m, 'b', 2, 2);
    setBounded(m, 'a', 3, 2);
    setBounded(m, 'c', 4, 2);
    expect([...m.entries()]).toEqual([
      ['a', 3],
      ['c', 4],
    ]);
  });
});
