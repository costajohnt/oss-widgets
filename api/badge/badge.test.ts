import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, {
  pickColor,
  errorBadge,
  computeBadge,
  staleFallback,
  getRepoStars,
  badgeCache,
  starCache,
  type BadgeResponse,
} from './[username].js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Hoist mock references so they're available inside vi.mock factory
const { octokitMocks } = vi.hoisted(() => {
  const searchFn = vi.fn();
  const reposGetFn = vi.fn();
  return {
    octokitMocks: {
      search: { issuesAndPullRequests: searchFn },
      repos: { get: reposGetFn },
    },
  };
});

vi.mock('@octokit/rest', () => {
  // Must use a function (not arrow) so it's callable with `new`
  return {
    Octokit: vi.fn(function () {
      return octokitMocks;
    }),
  };
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
  return { repository_url: `https://api.github.com/repos/${repoFullName}` };
}

/**
 * Configure the Octokit search mock to return specific PR counts.
 * The three calls correspond to: merged, closedUnmerged, open.
 */
function mockSearchResults(
  merged: { repository_url: string }[],
  closed: { repository_url: string }[],
  open: { repository_url: string }[],
) {
  const searchFn = octokitMocks.search.issuesAndPullRequests;
  // Each search call returns all items in one page
  searchFn.mockResolvedValueOnce({ data: { total_count: merged.length, items: merged } });
  searchFn.mockResolvedValueOnce({ data: { total_count: closed.length, items: closed } });
  searchFn.mockResolvedValueOnce({ data: { total_count: open.length, items: open } });
}

/** Configure repos.get to return a given star count for any repo. */
function mockRepoStars(stars: number) {
  octokitMocks.repos.get.mockResolvedValue({ data: { stargazers_count: stars } });
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let originalToken: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  badgeCache.clear();
  starCache.clear();
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

    const result = await computeBadge('testuser', 50);
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
    expect(octokitMocks.search.issuesAndPullRequests).toHaveBeenCalledTimes(3); // 3 search queries

    // Second call — should hit cache, no new API calls
    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res2);
    expect(res2._status).toBe(200);
    expect(res2._body).toEqual(res1._body);
    // Still only 3 calls total (no new ones)
    expect(octokitMocks.search.issuesAndPullRequests).toHaveBeenCalledTimes(3);
  });

  it('does not use cache from a different minStars key', async () => {
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(100);

    const res1 = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '10' }), res1);
    expect(octokitMocks.search.issuesAndPullRequests).toHaveBeenCalledTimes(3);

    // Different minStars — cache key differs
    mockSearchResults([makePR('owner/repo')], [], []);
    mockRepoStars(100);

    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '20' }), res2);
    // Should have made 3 more search calls (6 total)
    expect(octokitMocks.search.issuesAndPullRequests).toHaveBeenCalledTimes(6);
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

    // Now make the search throw an error
    octokitMocks.search.issuesAndPullRequests.mockRejectedValue(new Error('API failure'));

    const res2 = makeRes();
    await handler(makeReq({ username: 'testuser' }), res2);

    expect(res2._status).toBe(200);
    expect(res2._body).toEqual(cachedBadge);
    expect(res2._headers['Cache-Control']).toBe('no-cache, no-store');
  });

  it('returns "temporarily unavailable" when no stale cache exists and computation fails', async () => {
    octokitMocks.search.issuesAndPullRequests.mockRejectedValue(new Error('API failure'));

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('temporarily unavailable'));
  });

  it('returns "user not found" for 422 errors', async () => {
    const error = Object.assign(new Error('Validation Failed'), { status: 422 });
    octokitMocks.search.issuesAndPullRequests.mockRejectedValue(error);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._body).toEqual(errorBadge('user not found'));
  });

  it('returns stale fallback for 403 rate limit errors', async () => {
    const error = Object.assign(new Error('rate limited'), { status: 403 });
    octokitMocks.search.issuesAndPullRequests.mockRejectedValue(error);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._headers['Cache-Control']).toBe('no-cache, no-store');
  });

  it('returns stale fallback for 429 rate limit errors', async () => {
    const error = Object.assign(new Error('rate limited'), { status: 429 });
    octokitMocks.search.issuesAndPullRequests.mockRejectedValue(error);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser' }), res);

    expect(res._status).toBe(200);
    expect(res._headers['Cache-Control']).toBe('no-cache, no-store');
  });
});

// ===========================================================================
// 9. getRepoStars logs warning on non-404 errors
// ===========================================================================
describe('getRepoStars — error handling', () => {
  it('logs a console.warn for non-404 errors during star fetch in computeBadge', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Return one merged PR
    mockSearchResults([makePR('owner/failing-repo')], [], []);

    // Make repos.get throw a 500 (non-404) error
    const error = Object.assign(new Error('Internal Server Error'), { status: 500 });
    octokitMocks.repos.get.mockRejectedValue(error);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '0' }), res);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[badge] Failed to fetch stars for owner/failing-repo:'),
      expect.stringContaining('Internal Server Error'),
    );

    warnSpy.mockRestore();
  });

  it('silently returns 0 stars for 404 errors (private/deleted repos)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockSearchResults([makePR('owner/deleted-repo')], [], []);

    const error = Object.assign(new Error('Not Found'), { status: 404 });
    octokitMocks.repos.get.mockRejectedValue(error);

    const res = makeRes();
    await handler(makeReq({ username: 'testuser', minStars: '0' }), res);

    // Should NOT have logged a warning for 404
    const badgeLogs = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('[badge] Failed to fetch stars'),
    );
    expect(badgeLogs).toHaveLength(0);

    warnSpy.mockRestore();
  });

  it('uses cached star count within TTL', async () => {
    // Pre-populate the star cache
    starCache.set('owner/cached-repo', { stars: 200, ts: Date.now() });

    const fakeOctokit = octokitMocks as any;
    const stars = await getRepoStars(fakeOctokit, 'owner', 'cached-repo');

    expect(stars).toBe(200);
    // repos.get should not have been called — served from cache
    expect(octokitMocks.repos.get).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// 10. "Getting Started" state when no merged/open PRs
// ===========================================================================
describe('computeBadge — Getting Started state', () => {
  it('returns "Getting Started" badge when user has no merged or open PRs', async () => {
    // All three searches return empty
    mockSearchResults([], [], []);

    const result = await computeBadge('newuser', 50);

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

    const result = await computeBadge('testuser', 50);

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

    const result = await computeBadge('testuser', 50);

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

    const result = await computeBadge('prolific', 50);

    // mergeRate = 8/(8+2) = 0.8 → brightgreen
    expect(result.color).toBe('brightgreen');
    expect(result.message).toBe('80% merge rate | 8 merged | 1 open');
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
