import { describe, it, expect } from 'vitest';
import { renderTopReposCard } from './svg-top-repos.js';
import type { ContributionData } from './github-data.js';

const baseData: ContributionData = {
  merged: 50,
  open: 3,
  closedUnmerged: 5,
  mergeRate: 91,
  repoCount: 10,
  recentPRs: [],
  cappedMerged: false,
  cappedClosedUnmerged: false,
  dailyActivity: {},
  streak: 5,
  topRepos: [
    { repo: 'vadimdemedes/ink', count: 18 },
    { repo: 'owncast/owncast', count: 7 },
    { repo: 'super-productivity/super-productivity', count: 7 },
    { repo: 'Homebrew/brew', count: 6 },
    { repo: 'sindresorhus/eslint-plugin-unicorn', count: 6 },
  ],
};

describe('renderTopReposCard', () => {
  it('produces valid SVG with correct width', () => {
    const svg = renderTopReposCard(baseData, 'light');
    expect(svg).toContain('width="495"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('displays all repo names', () => {
    const svg = renderTopReposCard(baseData, 'light');
    expect(svg).toContain('vadimdemedes/ink');
    expect(svg).toContain('owncast/owncast');
    expect(svg).toContain('Homebrew/brew');
  });

  it('displays PR counts', () => {
    const svg = renderTopReposCard(baseData, 'light');
    expect(svg).toContain('18 PRs');
    expect(svg).toContain('7 PRs');
    expect(svg).toContain('6 PRs');
  });

  it('uses singular "PR" for count of 1', () => {
    const data = { ...baseData, topRepos: [{ repo: 'foo/bar', count: 1 }] };
    const svg = renderTopReposCard(data, 'light');
    expect(svg).toContain('1 PR');
    expect(svg).not.toContain('1 PRs');
  });

  it('renders dark theme', () => {
    const svg = renderTopReposCard(baseData, 'dark');
    expect(svg).toContain('#0d1117');
  });

  it('renders gracefully with empty topRepos', () => {
    const data = { ...baseData, topRepos: [] };
    const svg = renderTopReposCard(data, 'light');
    expect(svg).toContain('No external contributions');
  });

  it('caps at 8 repos', () => {
    const manyRepos = Array.from({ length: 12 }, (_, i) => ({
      repo: `org/repo-${i}`,
      count: 12 - i,
    }));
    const data = { ...baseData, topRepos: manyRepos };
    const svg = renderTopReposCard(data, 'light');
    expect(svg).toContain('org/repo-0');
    expect(svg).toContain('org/repo-7');
    expect(svg).not.toContain('org/repo-8');
  });

  it('truncates long repo names', () => {
    const data = {
      ...baseData,
      topRepos: [{ repo: 'very-long-organization-name/extremely-long-repository-name-that-exceeds-limits', count: 5 }],
    };
    const svg = renderTopReposCard(data, 'light');
    expect(svg).toContain('\u2026'); // ellipsis
  });

  it('escapes XML entities in repo names', () => {
    const data = {
      ...baseData,
      topRepos: [{ repo: 'org/<script>', count: 3 }],
    };
    const svg = renderTopReposCard(data, 'light');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toContain('<script>');
  });

  it('includes the header text', () => {
    const svg = renderTopReposCard(baseData, 'light');
    expect(svg).toContain('Top Contributed Repos');
  });

  it('includes the crystal icon', () => {
    const svg = renderTopReposCard(baseData, 'light');
    expect(svg).toContain('url(#a1)');
  });
});
