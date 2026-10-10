import { describe, it, expect } from 'vitest';
import { DEFAULT_MIN_STARS, parseMinStars, qualifyingStats } from './min-stars.js';
import type { ContributionData } from './github-data.js';

describe('parseMinStars', () => {
  it('parses numbers, defaults non-numeric values, and clamps negatives', () => {
    expect(parseMinStars('10')).toBe(10);
    expect(parseMinStars('010')).toBe(10);
    expect(parseMinStars('10x')).toBe(10);
    expect(parseMinStars('0')).toBe(0);
    expect(parseMinStars('-5')).toBe(0);
    expect(parseMinStars('abc')).toBe(DEFAULT_MIN_STARS);
    expect(parseMinStars(undefined)).toBe(DEFAULT_MIN_STARS);
    expect(parseMinStars(['10'])).toBe(DEFAULT_MIN_STARS);
  });
});

describe('qualifyingStats', () => {
  const data = {
    topRepos: [
      { repo: 'big/a', count: 4 },
      { repo: 'tiny/b', count: 6 },
    ],
    externalMergedPRs: [
      { number: 1, title: 'x', url: 'u1', repo: 'tiny/b', mergedAt: '2026-03-02T00:00:00Z' },
      { number: 2, title: 'y', url: 'u2', repo: 'big/a', mergedAt: '2026-03-01T00:00:00Z' },
    ],
    externalClosedUnmergedByRepo: { 'big/a': 1, 'tiny/b': 9 },
    externalOpenByRepo: { 'big/a': 2, 'tiny/b': 3, 'unknown/c': 1 },
    repoStars: { 'big/a': 100, 'tiny/b': 5 },
  } as unknown as ContributionData;

  it('restricts every count to repos meeting minStars', () => {
    const stats = qualifyingStats(data, 50);
    expect(stats.merged).toBe(4);
    expect(stats.closedUnmerged).toBe(1);
    expect(stats.open).toBe(2);
    expect(stats.mergeRate).toBe(80);
    expect(stats.topRepos).toEqual([{ repo: 'big/a', count: 4 }]);
    expect(stats.mergedPRs.map((pr) => pr.number)).toEqual([2]);
  });

  it('includes everything external at minStars=0', () => {
    const stats = qualifyingStats(data, 0);
    expect(stats.merged).toBe(10);
    expect(stats.closedUnmerged).toBe(10);
    expect(stats.open).toBe(6);
    expect(stats.mergeRate).toBe(50);
  });

  it('reports a 0% merge rate when nothing qualifies', () => {
    expect(qualifyingStats(data, 10_000).mergeRate).toBe(0);
  });
});
