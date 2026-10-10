import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('./github-data.js', () => ({
  fetchContributionData: fetchMock,
}));

import { getContributionData, _resetForTest, FORCE_MIN_AGE_MS, MAX_ENTRIES } from './contribution-cache.js';

const okData = {
  merged: 5,
  open: 0,
  closedUnmerged: 0,
  mergeRate: 100,
  repoCount: 1,
  recentPRs: [],
  cappedMerged: false,
  cappedClosedUnmerged: false,
  dailyActivity: {},
  streak: 0,
  topRepos: [],
  repoStars: {},
  externalMergedPRs: [],
  externalClosedUnmergedByRepo: {},
  externalOpenByRepo: {},
};

describe('getContributionData', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    _resetForTest();
    vi.restoreAllMocks();
  });

  it('deduplicates concurrent calls for the same username', async () => {
    fetchMock.mockResolvedValue(okData);

    const [a, b, c, d] = await Promise.all([
      getContributionData('alice', 'tok'),
      getContributionData('alice', 'tok'),
      getContributionData('alice', 'tok'),
      getContributionData('alice', 'tok'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(c).toBe(d);
  });

  it('returns separate fetches for different usernames', async () => {
    fetchMock.mockResolvedValue(okData);

    await Promise.all([
      getContributionData('alice', 'tok'),
      getContributionData('bob', 'tok'),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache error results — next call retries', async () => {
    fetchMock.mockResolvedValueOnce({ error: 'rate_limited' as const });
    fetchMock.mockResolvedValueOnce(okData);

    const first = await getContributionData('alice', 'tok');
    expect((first as { error?: string }).error).toBe('rate_limited');

    const second = await getContributionData('alice', 'tok');
    expect(second).toEqual(okData);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache rejected promises — next call retries', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    fetchMock.mockResolvedValueOnce(okData);

    await expect(getContributionData('alice', 'tok')).rejects.toThrow('boom');
    const second = await getContributionData('alice', 'tok');
    expect(second).toEqual(okData);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves the same successful result on subsequent calls within TTL', async () => {
    fetchMock.mockResolvedValue(okData);

    const a = await getContributionData('alice', 'tok');
    const b = await getContributionData('alice', 'tok');

    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force does not refetch an entry younger than FORCE_MIN_AGE_MS', async () => {
    fetchMock.mockResolvedValue(okData);

    await getContributionData('alice', 'tok');
    await getContributionData('alice', 'tok', { force: true });
    await getContributionData('alice', 'tok', { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('force refetches an entry at least FORCE_MIN_AGE_MS old (but within TTL)', async () => {
    fetchMock.mockResolvedValue(okData);
    await getContributionData('alice', 'tok');

    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + FORCE_MIN_AGE_MS);
    await getContributionData('alice', 'tok');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await getContributionData('alice', 'tok', { force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest user once MAX_ENTRIES is exceeded', async () => {
    fetchMock.mockResolvedValue(okData);

    for (let i = 0; i <= MAX_ENTRIES; i++) {
      await getContributionData(`user${i}`, 'tok');
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ENTRIES + 1);

    // Most recent is still cached; the first one was evicted.
    await getContributionData(`user${MAX_ENTRIES}`, 'tok');
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ENTRIES + 1);
    await getContributionData('user0', 'tok');
    expect(fetchMock).toHaveBeenCalledTimes(MAX_ENTRIES + 2);
  });
});
