import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchContributionData, computeStreak } from './github-data.js';

const { searchMock, graphqlMock } = vi.hoisted(() => {
  const searchMock = vi.fn();
  const graphqlMock = vi.fn();
  return { searchMock, graphqlMock };
});

vi.mock('@octokit/rest', () => {
  return {
    Octokit: vi.fn(function (this: any) {
      this.rest = {
        search: { issuesAndPullRequests: searchMock },
      };
      this.graphql = graphqlMock;
    }),
  };
});

interface RestLikeItem {
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  closed_at: string;
  pull_request: { merged_at: string };
}

/** Build a single GraphQL search page from a list of REST-shaped items. */
function gqlPage(
  items: RestLikeItem[],
  totalCount: number,
  hasNextPage: boolean = false,
  endCursor: string | null = null,
  starsByRepo: Record<string, number> = {},
) {
  return {
    search: {
      issueCount: totalCount,
      pageInfo: { hasNextPage, endCursor },
      nodes: items.map((i) => {
        const repo = i.repository_url.replace('https://api.github.com/repos/', '');
        return {
          number: i.number,
          title: i.title,
          url: i.html_url,
          mergedAt: i.pull_request?.merged_at ?? i.closed_at ?? '',
          repository: {
            nameWithOwner: repo,
            stargazerCount: starsByRepo[repo] ?? 0,
          },
        };
      }),
    },
  };
}

describe('fetchContributionData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns contribution stats for a valid user', async () => {
    const items: RestLikeItem[] = [
      {
        number: 1,
        title: 'Fix bug',
        html_url: 'https://github.com/org/repo/pull/1',
        repository_url: 'https://api.github.com/repos/org/repo',
        closed_at: '2026-03-01T00:00:00Z',
        pull_request: { merged_at: '2026-03-01T00:00:00Z' },
      },
      {
        number: 2,
        title: 'Add feature',
        html_url: 'https://github.com/org/repo2/pull/2',
        repository_url: 'https://api.github.com/repos/org/repo2',
        closed_at: '2026-02-15T00:00:00Z',
        pull_request: { merged_at: '2026-02-15T00:00:00Z' },
      },
    ];
    graphqlMock.mockResolvedValueOnce(gqlPage(items, items.length, false, null, { 'org/repo': 100, 'org/repo2': 50 }));
    searchMock.mockResolvedValueOnce({ data: { total_count: 3, items: [] } });
    searchMock.mockResolvedValueOnce({ data: { total_count: 5, items: [] } });

    const result = await fetchContributionData('testuser', 'fake-token');

    expect(result.error).toBeUndefined();
    if ('error' in result && result.error) throw new Error('unexpected error');
    expect(result.merged).toBe(2);
    expect(result.open).toBe(3);
    expect(result.closedUnmerged).toBe(5);
    expect(result.mergeRate).toBeCloseTo(28.6, 0);
    expect(result.repoCount).toBe(2);
    expect(result.recentPRs).toHaveLength(2);
    expect(result.recentPRs[0].title).toBe('Fix bug');
    expect(result.cappedMerged).toBe(false);
    expect(result.topRepos).toEqual([
      { repo: 'org/repo', count: 1 },
      { repo: 'org/repo2', count: 1 },
    ]);
    expect(result.repoStars).toEqual({ 'org/repo': 100, 'org/repo2': 50 });
  });

  it('flags capped results when items still fall short of totalCount after both passes', async () => {
    const descItems: RestLikeItem[] = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/external/popular/pull/${i + 1}`,
      repository_url: 'https://api.github.com/repos/external/popular',
      closed_at: '2026-03-01T00:00:00Z',
      pull_request: { merged_at: '2026-03-01T00:00:00Z' },
    }));
    const ascItems: RestLikeItem[] = Array.from({ length: 100 }, (_, i) => ({
      number: 1000 + i,
      title: `Old PR ${1000 + i}`,
      html_url: `https://github.com/external/popular/pull/${1000 + i}`,
      repository_url: 'https://api.github.com/repos/external/popular',
      closed_at: '2025-06-01T00:00:00Z',
      pull_request: { merged_at: '2025-06-01T00:00:00Z' },
    }));
    // First pass (sort:updated-desc): 100 items, hasNextPage=false (simulated cap).
    graphqlMock.mockResolvedValueOnce(
      gqlPage(descItems, 2500, false, null, { 'external/popular': 800 }),
    );
    // Second pass (sort:updated-asc): 100 different items, hasNextPage=false (simulated cap).
    graphqlMock.mockResolvedValueOnce(
      gqlPage(ascItems, 2500, false, null, { 'external/popular': 800 }),
    );
    // Open + closed-unmerged via REST search
    searchMock.mockResolvedValueOnce({ data: { total_count: 10, items: [] } });
    searchMock.mockResolvedValueOnce({ data: { total_count: 20, items: [] } });

    const result = await fetchContributionData('prolific-user', 'fake-token');

    expect(result.error).toBeUndefined();
    if ('error' in result && result.error) throw new Error('unexpected error');
    expect(result.merged).toBe(2500);
    // 200 unique items < 2500 totalCount → capped
    expect(result.cappedMerged).toBe(true);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(result.topRepos).toEqual([{ repo: 'external/popular', count: 200 }]);
    expect(result.repoStars).toEqual({ 'external/popular': 800 });
  });

  it('runs a second pass with sort:updated-asc when first pass items < totalCount and dedupes by url', async () => {
    // Simulates a user with 150 merged PRs where GitHub's first-pass cap drops 50.
    // First pass returns PRs 1-100 (most recently updated).
    const firstPass: RestLikeItem[] = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/external/lib/pull/${i + 1}`,
      repository_url: 'https://api.github.com/repos/external/lib',
      closed_at: '2026-04-01T00:00:00Z',
      pull_request: { merged_at: '2026-04-01T00:00:00Z' },
    }));
    // Second pass returns PRs 51-150 (oldest-updated first); 50 overlap with first.
    const secondPass: RestLikeItem[] = Array.from({ length: 100 }, (_, i) => ({
      number: 51 + i,
      title: `PR ${51 + i}`,
      html_url: `https://github.com/external/lib/pull/${51 + i}`,
      repository_url: 'https://api.github.com/repos/external/lib',
      closed_at: '2025-08-01T00:00:00Z',
      pull_request: { merged_at: '2025-08-01T00:00:00Z' },
    }));
    graphqlMock.mockResolvedValueOnce(gqlPage(firstPass, 150, false, null, { 'external/lib': 500 }));
    graphqlMock.mockResolvedValueOnce(gqlPage(secondPass, 150, false, null, { 'external/lib': 500 }));
    searchMock.mockResolvedValueOnce({ data: { total_count: 0, items: [] } });
    searchMock.mockResolvedValueOnce({ data: { total_count: 0, items: [] } });

    const result = await fetchContributionData('user', 'fake-token');

    expect(result.error).toBeUndefined();
    if ('error' in result && result.error) throw new Error('unexpected error');
    expect(result.merged).toBe(150);
    expect(result.cappedMerged).toBe(false);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
    // 200 raw items dedupe to 150 unique by URL
    expect(result.topRepos).toEqual([{ repo: 'external/lib', count: 150 }]);
  });

  it('skips the second pass when first-pass items already cover totalCount', async () => {
    const items: RestLikeItem[] = Array.from({ length: 5 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/external/lib/pull/${i + 1}`,
      repository_url: 'https://api.github.com/repos/external/lib',
      closed_at: '2026-03-01T00:00:00Z',
      pull_request: { merged_at: '2026-03-01T00:00:00Z' },
    }));
    graphqlMock.mockResolvedValueOnce(gqlPage(items, 5, false, null, { 'external/lib': 100 }));
    searchMock.mockResolvedValueOnce({ data: { total_count: 0, items: [] } });
    searchMock.mockResolvedValueOnce({ data: { total_count: 0, items: [] } });

    const result = await fetchContributionData('user', 'fake-token');

    expect(result.error).toBeUndefined();
    if ('error' in result && result.error) throw new Error('unexpected error');
    expect(graphqlMock).toHaveBeenCalledTimes(1);
    expect(result.merged).toBe(5);
    expect(result.cappedMerged).toBe(false);
  });

  it('stops paginating when GraphQL reports hasNextPage=false', async () => {
    const items: RestLikeItem[] = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/org/repo/pull/${i + 1}`,
      repository_url: 'https://api.github.com/repos/org/repo',
      closed_at: '2026-03-01T00:00:00Z',
      pull_request: { merged_at: '2026-03-01T00:00:00Z' },
    }));
    const items50: RestLikeItem[] = Array.from({ length: 50 }, (_, i) => ({
      number: 100 + i + 1,
      title: `PR ${100 + i + 1}`,
      html_url: `https://github.com/org2/repo2/pull/${100 + i + 1}`,
      repository_url: 'https://api.github.com/repos/org2/repo2',
      closed_at: '2026-02-15T00:00:00Z',
      pull_request: { merged_at: '2026-02-15T00:00:00Z' },
    }));
    graphqlMock.mockResolvedValueOnce(gqlPage(items, 150, true, 'cursor1'));
    graphqlMock.mockResolvedValueOnce(gqlPage(items50, 150, false, null));
    searchMock.mockResolvedValueOnce({ data: { total_count: 5, items: [] } });
    searchMock.mockResolvedValueOnce({ data: { total_count: 10, items: [] } });

    const result = await fetchContributionData('testuser', 'fake-token');

    expect(result.error).toBeUndefined();
    if ('error' in result && result.error) throw new Error('unexpected error');
    expect(result.merged).toBe(150);
    expect(result.repoCount).toBe(2);
    expect(result.cappedMerged).toBe(false);
    expect(graphqlMock).toHaveBeenCalledTimes(2);
  });

  it('returns error state for non-existent user', async () => {
    graphqlMock.mockRejectedValueOnce({ status: 422 });

    const result = await fetchContributionData('nonexistent', 'fake-token');

    expect(result.error).toBe('user_not_found');
  });

  it('returns error state on rate limit', async () => {
    graphqlMock.mockRejectedValueOnce({ status: 403 });

    const result = await fetchContributionData('anyuser', 'fake-token');

    expect(result.error).toBe('rate_limited');
  });

  it('returns api_error for unexpected errors', async () => {
    graphqlMock.mockRejectedValueOnce({ status: 500 });
    const result = await fetchContributionData('anyuser', 'fake-token');
    expect(result.error).toBe('api_error');
  });

  it('excludes own repos from topRepos and sorts by count', async () => {
    const items: RestLikeItem[] = [
      ...Array.from({ length: 3 }, (_, i) => ({
        number: i + 1,
        title: `PR ${i + 1}`,
        html_url: `https://github.com/external/popular/pull/${i + 1}`,
        repository_url: 'https://api.github.com/repos/external/popular',
        closed_at: '2026-03-01T00:00:00Z',
        pull_request: { merged_at: '2026-03-01T00:00:00Z' },
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        number: 10 + i,
        title: `Own PR ${i + 1}`,
        html_url: `https://github.com/myuser/myrepo/pull/${10 + i}`,
        repository_url: 'https://api.github.com/repos/myuser/myrepo',
        closed_at: '2026-03-01T00:00:00Z',
        pull_request: { merged_at: '2026-03-01T00:00:00Z' },
      })),
      {
        number: 20,
        title: 'Small fix',
        html_url: 'https://github.com/other/lib/pull/20',
        repository_url: 'https://api.github.com/repos/other/lib',
        closed_at: '2026-03-01T00:00:00Z',
        pull_request: { merged_at: '2026-03-01T00:00:00Z' },
      },
    ];

    graphqlMock.mockResolvedValueOnce(gqlPage(items, items.length, false, null));
    searchMock.mockResolvedValueOnce({ data: { total_count: 0, items: [] } });
    searchMock.mockResolvedValueOnce({ data: { total_count: 0, items: [] } });

    const result = await fetchContributionData('myuser', 'fake-token');

    expect(result.error).toBeUndefined();
    if ('error' in result && result.error) throw new Error('unexpected error');
    expect(result.topRepos).toEqual([
      { repo: 'external/popular', count: 3 },
      { repo: 'other/lib', count: 1 },
    ]);
    expect(result.repoCount).toBe(3);
  });
});

describe('computeStreak', () => {
  function mondayOf(date: Date): Date {
    const d = new Date(date);
    const dayOfWeek = d.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  function dateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  it('returns 0 when there is no activity', () => {
    expect(computeStreak({})).toBe(0);
  });

  it('returns 3 for three consecutive weeks with activity', () => {
    const thisMonday = mondayOf(new Date());
    const lastMonday = addDays(thisMonday, -7);
    const twoWeeksAgoMonday = addDays(thisMonday, -14);

    const dailyActivity: Record<string, number> = {
      [dateKey(thisMonday)]: 1,
      [dateKey(lastMonday)]: 2,
      [dateKey(twoWeeksAgoMonday)]: 1,
    };

    expect(computeStreak(dailyActivity)).toBe(3);
  });

  it('breaks the streak when there is a gap between weeks', () => {
    const thisMonday = mondayOf(new Date());
    const lastMonday = addDays(thisMonday, -7);
    const threeWeeksAgoMonday = addDays(thisMonday, -21);

    const dailyActivity: Record<string, number> = {
      [dateKey(thisMonday)]: 1,
      [dateKey(lastMonday)]: 1,
      [dateKey(threeWeeksAgoMonday)]: 1,
    };

    expect(computeStreak(dailyActivity)).toBe(2);
  });

  it('counts prior weeks when the current week has no activity', () => {
    const thisMonday = mondayOf(new Date());
    const lastMonday = addDays(thisMonday, -7);
    const twoWeeksAgoMonday = addDays(thisMonday, -14);

    const dailyActivity: Record<string, number> = {
      [dateKey(lastMonday)]: 3,
      [dateKey(twoWeeksAgoMonday)]: 1,
    };

    expect(computeStreak(dailyActivity)).toBe(2);
  });
});

describe('username validation', () => {
  it('accepts valid GitHub usernames', async () => {
    const { isValidUsername } = await import('./github-data.js');
    expect(isValidUsername('costajohnt')).toBe(true);
    expect(isValidUsername('some-user')).toBe(true);
    expect(isValidUsername('a')).toBe(true);
  });

  it('rejects invalid usernames', async () => {
    const { isValidUsername } = await import('./github-data.js');
    expect(isValidUsername('')).toBe(false);
    expect(isValidUsername('-starts-with-dash')).toBe(false);
    expect(isValidUsername('has spaces')).toBe(false);
    expect(isValidUsername('has--double-dash')).toBe(false);
    expect(isValidUsername('a'.repeat(40))).toBe(false);
  });
});
