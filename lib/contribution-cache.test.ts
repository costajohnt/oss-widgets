import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('./github-data.js', () => ({
  fetchContributionData: fetchMock,
}));

import { getContributionData, _resetForTest } from './contribution-cache.js';

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
};

describe('getContributionData', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    _resetForTest();
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
});
