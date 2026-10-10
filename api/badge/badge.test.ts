import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, {
  pickColor,
  errorBadge,
  computeBadge,
  staleFallback,
  badgeCache,
  type BadgeResponse,
} from './[username].js';
import { _resetForTest as resetContributionCache } from '../../lib/contribution-cache.js';
import type { ContributionData, ContributionResult } from '../../lib/github-data.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// The badge reads the shared contribution data; mock the fetch beneath the
// shared cache so the cache itself is exercised.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock('../../lib/github-data.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/github-data.js')>();
  return { ...actual, fetchContributionData: fetchMock };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a simple mock VercelRequest. */
function makeReq(query: Record<string, string>): any {
  return { query };
}

/** Build a mock VercelResponse that records status code, JSON body, and headers. */
function makeRes() {
  const res: any = {
    _status: 0,
    _body: null as unknown,
    _headers: {} as Record<string, string>,
  };

  res.setHeader = (name: string, value: string) => {
    res._headers[name] = value;
    return res;
  };

  res.status = (code: number) => {
    res._status = code;
    return res;
  };

  res.json = (body: unknown) => {
    res._body = body;
    return res;
  };

  return res;
}

/** Build a fake PR item pointing at a repo. */
function makePR(repoFullName: string) {
  return { repo: repoFullName };
}

let pending: { merged: { repo: string }[]; closed: { repo: string }[]; open: { repo: string }[] } = {
  merged: [],
  closed: [],
  open: [],
};
let starsForAll = 0;

function countByRepo(items: { repo: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { repo } of items) out[repo] = (out[repo] ?? 0) + 1;
  return out;
}

/** Build ContributionData for external PRs; every repo gets `stars` stars. */
function buildData(
  merged: { repo: string }[],
  closed: { repo: string }[],
  open: { repo: string }[],
  stars: number,
): ContributionData {
  const mergedByRepo = countByRepo(merged);
  const repoStars: Record<string, number> = {};
  for (const { repo } of [...merged, ...closed, ...open]) repoStars[repo] = stars;
  const total = merged.length + closed.length;
  return {
    merged: merged.length,
    open: open.length,
    closedUnmerged: closed.length,
    mergeRate: total > 0 ? (merged.length / total) * 100 : 0,
    repoCount: Object.keys(mergedByRepo).length,
    recentPRs: [],
    externalMergedPRs: merged.map((pr, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      url: `https://github.com/${pr.repo}/pull/${i + 1}`,
      repo: pr.repo,
      mergedAt: '2026-03-01T00:00:00Z',
    })),
    externalClosedUnmergedByRepo: countByRepo(closed),
    externalOpenByRepo: countByRepo(open),
    cappedMerged: false,
    cappedClosedUnmerged: false,
    dailyActivity: {},
    streak: 0,
    topRepos: Object.entries(mergedByRepo)
      .map(([repo, count]) => ({ repo, count }))
      .sort((x, y) => y.count - x.count),
    repoStars,
  };
}

/**
 * Configure the contribution fetch to return these external merged,
 * closed-unmerged and open PRs (built at fetch time with the current stars).
 */
function mockSearchResults(merged: { repo: string }[], closed: { repo: string }[], open: { repo: string }[]) {
  pending = { merged, closed, open };
}

/** Star count applied to every repo in the mocked data. */
function mockRepoStars(stars: number) {
  starsForAll = stars;
}

/** Make the contribution fetch fail with the given error kind. */
function mockFetchError(error: Exclude<ContributionResult['error'], undefined>) {
  fetchMock.mockImplementation(async () => ({ error }));
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalToken: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  badgeCache.clear();
  resetContributionCache();
  pending = { merged: [], closed: [], open: [] };
  starsForAll = 0;
  fetchMock.mockImplementation(async () => buildData(pending.merged, pending.closed, pending.open, starsForAll));
  originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'fake-token';
});

afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = originalToken;
  }
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. pickColor thresholds
// ===========================================================================
describe('pickColor', () => {
  it('returns brightgreen for mergeRate >= 0.8', () => {
    expect(pickColor(0.8)).toBe('brightgreen');
    expect(pickColor(0.95)).toBe('brightgreen');
    expect(pickColor(1.0)).toBe('brightgreen');
  });

  it('returns green for mergeRate >= 0.6 and < 0.8', () => {
    expect(pickColor(0.6)).toBe('green');
    expect(pickColor(0.79)).toBe('green');
  });

  it('returns yellow for mergeRate >= 0.4 and < 0.6', () => {
    expect(pickColor(0.4)).toBe('yellow');
    expect(pickColor(0.59)).toBe('yellow');
  });

  it('returns orange for mergeRate < 0.4', () => {
    expect(pickColor(0.0)).toBe('orange');
    expect(pickColor(0.39)).toBe('orange');
  });
});

// ===========================================================================
// 2. Invalid username returns error badge
// ===========================================================================
describe('handler — invalid username', () => {
  it('returns error badge for invalid username', async () => {
    const res = makeRes();
    await handler(makeReq({ username: '-bad-user' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('invalid username'));
  });

  it('returns error badge when username is missing', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('invalid username'));
  });
});

// ===========================================================================
// 3. minStars=0 correctly passes 0 (not default 50) — regression test
// ===========================================================================
describe('handler — minStars parsing', () => {
  it('passes minStars=0 to computeBadge when explicitly set (not default 50)', async () => {
    // Set up: one merged PR in a repo with 10 stars (below default 50, above 0)
    const mergedPR = makePR('owner/small-repo');
    mockSearchResults([mergedPR], [], []);
    mockRepoStars(10);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '0' }), res);

    expect(res._status).toBe(200);
    const body = res._body as BadgeResponse;
    // With minStars=0 and 10 stars, the repo qualifies. With default 50 it would not.
    expect(body.message).toContain('merged');
    expect(body.color).not.toBe('lightgrey');
  });

  // 4. minStars=abc falls back to DEFAULT_MIN_STARS (50)
  it('falls back to DEFAULT_MIN_STARS (50) for non-numeric minStars', async () => {
    // Repo with 30 stars — below default 50
    const mergedPR = makePR('owner/medium-repo');
    mockSearchResults([mergedPR], [], []);
    mockRepoStars(30);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: 'abc' }), res);

    expect(res._status).toBe(200);
    const body = res._body as BadgeResponse;
    // 30 stars < 50 default, so repo doesn't qualify → "Getting Started"
    expect(body.message).toBe('Getting Started');
    expect(body.color).toBe('blue');
  });

  // 5. minStars negative clamped to 0
  it('clamps negative minStars to 0', async () => {
    // Repo with 0 stars — should still qualify when clamped to 0
    const mergedPR = makePR('owner/zero-star-repo');
    mockSearchResults([mergedPR], [], []);
    mockRepoStars(0);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '-10' }), res);

    expect(res._status).toBe(200);
    const body = res._body as BadgeResponse;
    // minStars clamped to 0, 0 >= 0, so repo qualifies
    expect(body.message).toContain('merged');
  });

  it('uses DEFAULT_MIN_STARS when minStars param is absent', async () => {
    // Repo with 100 stars — above default 50
    const mergedPR = makePR('owner/popular-repo');
    mockSearchResults([mergedPR], [], []);
    mockRepoStars(100);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    const body = res._body as BadgeResponse;
    expect(body.message).toContain('merged');
  });
});

// ===========================================================================
// 6. Missing GITHUB_TOKEN returns error badge
// ===========================================================================
describe('computeBadge — missing GITHUB_TOKEN', () => {
  it('returns server config error badge when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;

    const result = (await computeBadge('testuser', 50)) as BadgeResponse;
    expect(result).toEqual(errorBadge('server config error'));
  });

  it('returns server config error badge through handler when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;

    // Mock search to not reject (computeBadge should return early before calling Octokit)
    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('server config error'));
  });
});

// ===========================================================================
// 7. Cache hit returns cached badge
// ===========================================================================
describe('handler — badge caching', () => {
  it('returns cached badge on second call within TTL without re-computing', async () => {
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(100);

    const res1 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res1);
    expect(res1._status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call — should hit cache, no new fetch
    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res2);
    expect(res2._status).toBe(200);
    expect(res2._body).toEqual(res1._body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('computes a separate badge per minStars from one shared contribution fetch', async () => {
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(15);

    const res1 = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '10' }), res1);
    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '20' }), res2);

    expect((res1._body as BadgeResponse).message).toContain('1 merged');
    expect((res2._body as BadgeResponse).message).toBe('Getting Started');
    // Different badge cache keys, but the contribution data is shared.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(badgeCache.size).toBe(2);
  });

  it('normalizes minStars in the cache key so equivalent values share an entry', async () => {
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(100);

    for (const minStars of ['1', '01', '1x']) {
      await handler(makeReq({ username: 'testuser', minStars }), makeRes());
    }

    expect([...badgeCache.keys()]).toEqual(['testuser:1']);
  });
});

// ===========================================================================
// 8. Stale fallback works when computation fails
// ===========================================================================
describe('handler — stale fallback', () => {
  it('returns stale cached badge when computation fails and cache is within stale TTL', async () => {
    const BADGE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

    // First call — populate cache
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(100);

    const res1 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res1);
    expect(res1._status).toBe(200);
    const cachedBadge = res1._body;

    // Advance time past BADGE_CACHE_TTL but within STALE_BADGE_TTL
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + BADGE_CACHE_TTL + 5000);

    // Now make the fetch fail
    mockFetchError('api_error');

    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res2);

    expect(res2._status).toBe(200);
    expect(res2._body).toEqual(cachedBadge);
    expect(res2._headers['Cache-Control']).toBe('no-cache, no-store');
  });

  it('returns "temporarily unavailable" when no stale cache exists and computation fails', async () => {
    mockFetchError('api_error');

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('temporarily unavailable'));
  });

  it('returns "user not found" when the user does not exist', async () => {
    mockFetchError('user_not_found');

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('user not found'));
  });

  it('returns stale fallback for rate limit errors', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockFetchError('rate_limited');

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('temporarily unavailable'));
    expect(res._headers['Cache-Control']).toBe('no-cache, no-store');
  });

  it('does not cache error results', async () => {
    mockFetchError('api_error');

    await handler(makeReq({ username: 'testuser' }), makeRes());

    expect(badgeCache.size).toBe(0);
  });
});

// ===========================================================================
// 9. Shared data source and filtering
// ===========================================================================
describe('computeBadge — shared contribution data', () => {
  it('reads the shared contribution data instead of making its own GitHub calls', async () => {
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(100);

    await computeBadge('testuser', 50);
    await computeBadge('testuser', 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('testuser', 'fake-token');
  });

  it('filters merged, closed and open by repo stars independently', async () => {
    // Merged: 3 in a big repo; closed: 1 big + 5 tiny; open: 2 tiny.
    fetchMock.mockImplementation(async () => {
      const data = buildData(
        [makePR('big/repo'), makePR('big/repo'), makePR('big/repo')],
        [makePR('big/repo'), ...Array.from({ length: 5 }, () => makePR('tiny/repo'))],
        [makePR('tiny/repo'), makePR('tiny/repo')],
        0,
      );
      return { ...data, repoStars: { 'big/repo': 500, 'tiny/repo': 3 } };
    });

    const result = (await computeBadge('testuser', 50)) as BadgeResponse;

    // 3 merged / (3 + 1 closed) = 75%; tiny-repo closed and open PRs excluded.
    expect(result).toEqual({
      schemaVersion: 1,
      label: 'OSS Contributions',
      message: '75% merge rate | 3 merged | 0 open',
      color: 'green',
    });
  });
});

// ===========================================================================
// 10. "Getting Started" state when no merged/open PRs
// ===========================================================================
describe('computeBadge — Getting Started state', () => {
  it('returns "Getting Started" badge when user has no merged or open PRs', async () => {
    // All three searches return empty
    mockSearchResults([], [], []);

    const result = (await computeBadge('newuser', 50)) as BadgeResponse;

    expect(result).toEqual({
      schemaVersion: 1,
      label: 'OSS Contributions',
      message: 'Getting Started',
      color: 'blue',
    });
  });

  it('returns "Getting Started" when all PRs are in repos below minStars', async () => {
    mockSearchResults([makePR('owner/tiny-repo')], [], []);
    mockRepoStars(5); // 5 < 50

    const result = (await computeBadge('testuser', 50)) as BadgeResponse;

    expect(result).toEqual({
      schemaVersion: 1,
      label: 'OSS Contributions',
      message: 'Getting Started',
      color: 'blue',
    });
  });

  it('returns "Getting Started" when user only has closed-unmerged PRs (no merged, no open)', async () => {
    mockSearchResults([], [makePR('owner/repo')], []);
    mockRepoStars(100);

    const result = (await computeBadge('testuser', 50)) as BadgeResponse;

    // mergedCount=0, openCount=0 → Getting Started
    expect(result.message).toBe('Getting Started');
    expect(result.color).toBe('blue');
  });
});

// ===========================================================================
// Additional: Shields.io response format
// ===========================================================================
describe('badge response format', () => {
  it('always returns HTTP 200 (Shields.io requirement)', async () => {
    // Invalid username
    const res1 = makeRes();
    await handler(makeReq({ username: '-invalid' }), res1);
    expect(res1._status).toBe(200);

    // Missing token
    delete process.env.GITHUB_TOKEN;
    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res2);
    expect(res2._status).toBe(200);
  });

  it('errorBadge returns correct Shields.io JSON structure', () => {
    const badge = errorBadge('test error');
    expect(badge).toEqual({
      schemaVersion: 1,
      label: 'OSS Contributions',
      message: 'test error',
      color: 'lightgrey',
    });
  });

  it('success badge includes merge rate, merged count, and open count', async () => {
    const repo = 'owner/big-repo';
    // 8 merged, 2 closed-unmerged, 1 open
    const merged = Array.from({ length: 8 }, () => makePR(repo));
    const closed = Array.from({ length: 2 }, () => makePR(repo));
    const open = [makePR(repo)];

    mockSearchResults(merged, closed, open);
    mockRepoStars(500);

    const result = (await computeBadge('prolific', 50)) as BadgeResponse;

    // mergeRate = 8/(8+2) = 0.8 → brightgreen
    expect(result.color).toBe('brightgreen');
    expect(result.message).toBe('80% merge rate | 8 merged | 1 open');
  });

  it('marks merged as a lower bound and the rate as approximate when the fetch was capped (#12)', async () => {
    const repo = 'owner/big-repo';
    const merged = Array.from({ length: 8 }, () => makePR(repo));
    const closed = Array.from({ length: 2 }, () => makePR(repo));
    fetchMock.mockImplementation(async () => ({
      ...buildData(merged, closed, [], 500),
      cappedMerged: true,
      cappedClosedUnmerged: true,
    }));

    const result = (await computeBadge('prolific', 50)) as BadgeResponse;

    expect(result.message).toBe('~80% merge rate | 8+ merged | 0 open');
  });

  it('marks only the rate as approximate when just closed-unmerged was capped (#12)', async () => {
    const repo = 'owner/big-repo';
    const merged = Array.from({ length: 8 }, () => makePR(repo));
    const closed = Array.from({ length: 2 }, () => makePR(repo));
    fetchMock.mockImplementation(async () => ({
      ...buildData(merged, closed, [], 500),
      cappedClosedUnmerged: true,
    }));

    const result = (await computeBadge('prolific', 50)) as BadgeResponse;

    expect(result.message).toBe('~80% merge rate | 8 merged | 0 open');
  });
});

// ===========================================================================
// Additional: staleFallback unit tests
// ===========================================================================
describe('staleFallback', () => {
  it('returns stale badge when within stale TTL', () => {
    const badge: BadgeResponse = {
      schemaVersion: 1,
      label: 'OSS Contributions',
      message: '90% merge rate | 10 merged | 2 open',
      color: 'brightgreen',
    };
    badgeCache.set('user:50', { badge, ts: Date.now() - 2 * 60 * 60 * 1000 }); // 2 hours old

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = staleFallback('user:50', 'test reason');
    expect(result).toEqual(badge);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Serving stale cache'));
    warnSpy.mockRestore();
  });

  it('returns "temporarily unavailable" when stale cache is expired', () => {
    const STALE_TTL = 24 * 60 * 60 * 1000;
    const badge: BadgeResponse = {
      schemaVersion: 1,
      label: 'OSS Contributions',
      message: 'old data',
      color: 'green',
    };
    badgeCache.set('user:50', { badge, ts: Date.now() - STALE_TTL - 1000 }); // expired

    const result = staleFallback('user:50', 'expired');
    expect(result).toEqual(errorBadge('temporarily unavailable'));
  });

  it('returns "temporarily unavailable" when no cache exists at all', () => {
    const result = staleFallback('nonexistent:50', 'no cache');
    expect(result).toEqual(errorBadge('temporarily unavailable'));
  });
});
