import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRepoStars, getStarsForRepos, clearStarCache } from './github-stars.js';

// Mock Octokit
function makeOctokit(getMock: ReturnType<typeof vi.fn>) {
  return { repos: { get: getMock } } as any;
}

describe('getRepoStars', () => {
  beforeEach(() => {
    clearStarCache();
  });

  it('fetches and caches star count', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { stargazers_count: 500 } });
    const octokit = makeOctokit(getMock);

    const stars = await getRepoStars(octokit, 'owner', 'repo');
    expect(stars).toBe(500);
    expect(getMock).toHaveBeenCalledWith({ owner: 'owner', repo: 'repo' });

    // Second call should use cache
    const stars2 = await getRepoStars(octokit, 'owner', 'repo');
    expect(stars2).toBe(500);
    expect(getMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after cache expires', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { stargazers_count: 100 } });
    const octokit = makeOctokit(getMock);

    await getRepoStars(octokit, 'owner', 'repo');
    expect(getMock).toHaveBeenCalledTimes(1);

    // Advance time past 24hr TTL
    const realNow = Date.now;
    Date.now = () => realNow() + 25 * 60 * 60 * 1000;

    getMock.mockResolvedValue({ data: { stargazers_count: 200 } });
    const stars = await getRepoStars(octokit, 'owner', 'repo');
    expect(stars).toBe(200);
    expect(getMock).toHaveBeenCalledTimes(2);

    Date.now = realNow;
  });
});

describe('getStarsForRepos', () => {
  beforeEach(() => {
    clearStarCache();
  });

  it('returns star counts for multiple repos', async () => {
    const getMock = vi.fn()
      .mockResolvedValueOnce({ data: { stargazers_count: 100 } })
      .mockResolvedValueOnce({ data: { stargazers_count: 500 } });
    const octokit = makeOctokit(getMock);

    const result = await getStarsForRepos(octokit, ['org/repo1', 'org/repo2']);
    expect(result.get('org/repo1')).toBe(100);
    expect(result.get('org/repo2')).toBe(500);
  });

  it('returns 0 for 404 errors without logging', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getMock = vi.fn().mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));
    const octokit = makeOctokit(getMock);

    const result = await getStarsForRepos(octokit, ['owner/deleted']);
    expect(result.get('owner/deleted')).toBe(0);

    const starLogs = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('[stars] Failed'),
    );
    expect(starLogs).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('logs warning for non-404 errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getMock = vi.fn().mockRejectedValue(Object.assign(new Error('Server Error'), { status: 500 }));
    const octokit = makeOctokit(getMock);

    const result = await getStarsForRepos(octokit, ['owner/broken']);
    expect(result.get('owner/broken')).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[stars] Failed to fetch stars for owner/broken'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it('logs warning for malformed repo names', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getMock = vi.fn();
    const octokit = makeOctokit(getMock);

    const result = await getStarsForRepos(octokit, ['no-slash', '']);
    expect(result.get('no-slash')).toBe(0);
    expect(result.get('')).toBe(0);
    expect(getMock).not.toHaveBeenCalled(); // Never reaches API
    expect(warnSpy).toHaveBeenCalledWith('[stars] Malformed repo name: no-slash');
    warnSpy.mockRestore();
  });

  it('processes repos in batches', async () => {
    const getMock = vi.fn().mockResolvedValue({ data: { stargazers_count: 10 } });
    const octokit = makeOctokit(getMock);

    const repos = Array.from({ length: 15 }, (_, i) => `org/repo-${i}`);
    await getStarsForRepos(octokit, repos, 5);

    // 15 repos / batch size 5 = 3 batches, all resolved
    expect(getMock).toHaveBeenCalledTimes(15);
  });
});
