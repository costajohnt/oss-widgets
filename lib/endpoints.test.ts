import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContributionData, RecentPR } from './github-data.js';
import { _resetForTest as resetContributionCache } from './contribution-cache.js';

const { fetchMock, renderCard, renderRecent } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  renderCard: vi.fn((_data: unknown, _mode: unknown) => '<svg>card</svg>'),
  renderRecent: vi.fn((_data: unknown, _mode: unknown) => '<svg>recent</svg>'),
}));

vi.mock('./github-data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./github-data.js')>();
  return { ...actual, fetchContributionData: fetchMock };
});
vi.mock('./svg-card.js', () => ({ renderStatsCard: renderCard }));
vi.mock('./svg-recent.js', () => ({ renderRecentCard: renderRecent }));

const cardHandler = (await import('../api/card/[username].js')).default;
const recentHandler = (await import('../api/recent/[username].js')).default;

function makeRes() {
  const res: any = { _status: 0, _body: '', _headers: {} as Record<string, string> };
  res.setHeader = (k: string, v: string) => {
    res._headers[k] = v;
    return res;
  };
  res.status = (c: number) => {
    res._status = c;
    return res;
  };
  res.send = (b: string) => {
    res._body = b;
    return res;
  };
  return res;
}

function pr(n: number, repo: string, mergedAt: string): RecentPR {
  return { number: n, title: `PR ${n}`, url: `https://github.com/${repo}/pull/${n}`, repo, mergedAt };
}

function baseData(overrides: Partial<ContributionData> = {}): ContributionData {
  return {
    merged: 0,
    open: 0,
    closedUnmerged: 0,
    mergeRate: 0,
    repoCount: 0,
    recentPRs: [],
    externalMergedPRs: [],
    externalClosedUnmergedByRepo: {},
    externalOpenByRepo: {},
    cappedMerged: false,
    cappedClosedUnmerged: false,
    dailyActivity: {},
    streak: 0,
    topRepos: [],
    repoStars: {},
    ...overrides,
  };
}

let originalToken: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  resetContributionCache();
  originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fake-token';
});

afterEach(() => {
  if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalToken;
});

describe('recent endpoint', () => {
  it('fills 5 rows from older qualifying PRs when the newest PRs are in low-star repos', async () => {
    const prs = [
      ...Array.from({ length: 5 }, (_, i) => pr(100 + i, 'tiny/repo', `2026-03-1${i}T00:00:00Z`)).reverse(),
      ...Array.from({ length: 6 }, (_, i) => pr(i + 1, 'big/repo', `2026-02-0${i + 1}T00:00:00Z`)).reverse(),
    ];
    fetchMock.mockResolvedValue(
      baseData({ externalMergedPRs: prs, recentPRs: prs.slice(0, 5), repoStars: { 'tiny/repo': 3, 'big/repo': 900 } }),
    );

    const res = makeRes();
    await recentHandler({ query: { username: 'someone' } } as any, res);

    expect(res._status).toBe(200);
    const rendered = renderRecent.mock.calls[0][0] as ContributionData;
    expect(rendered.recentPRs.map((p) => p.number)).toEqual([6, 5, 4, 3, 2]);
  });
});

describe('card endpoint', () => {
  it('computes merged, merge rate, open and activity from the same filtered population', async () => {
    fetchMock.mockResolvedValue(
      baseData({
        // Unfiltered totals include own and low-star repos.
        merged: 20,
        open: 9,
        closedUnmerged: 10,
        mergeRate: 66.7,
        topRepos: [
          { repo: 'big/repo', count: 3 },
          { repo: 'tiny/repo', count: 7 },
        ],
        externalMergedPRs: [
          pr(1, 'big/repo', '2026-03-03T00:00:00Z'),
          pr(2, 'tiny/repo', '2026-03-02T00:00:00Z'),
          pr(3, 'big/repo', '2026-03-01T00:00:00Z'),
          pr(4, 'big/repo', '2026-03-01T12:00:00Z'),
        ],
        externalClosedUnmergedByRepo: { 'big/repo': 1, 'tiny/repo': 8 },
        externalOpenByRepo: { 'big/repo': 2, 'tiny/repo': 5 },
        dailyActivity: { '2026-03-02': 5 },
        repoStars: { 'big/repo': 500, 'tiny/repo': 2 },
      }),
    );

    const res = makeRes();
    await cardHandler({ query: { username: 'someone' } } as any, res);

    expect(res._status).toBe(200);
    const rendered = renderCard.mock.calls[0][0] as ContributionData;
    expect(rendered.merged).toBe(3);
    expect(rendered.closedUnmerged).toBe(1);
    expect(rendered.open).toBe(2);
    expect(rendered.mergeRate).toBe(75);
    expect(rendered.repoCount).toBe(1);
    expect(rendered.dailyActivity).toEqual({ '2026-03-03': 1, '2026-03-01': 2 });
  });
});
