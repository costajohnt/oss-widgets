import { fetchContributionData, type ContributionResult } from './github-data.js';

const TTL_MS = 60 * 60 * 1000;

interface Entry {
  promise: Promise<ContributionResult>;
  ts: number;
}

const cache = new Map<string, Entry>();

export function getContributionData(
  username: string,
  token: string,
  options: { force?: boolean } = {},
): Promise<ContributionResult> {
  if (!options.force) {
    const existing = cache.get(username);
    if (existing && Date.now() - existing.ts < TTL_MS) {
      return existing.promise;
    }
  }

  const promise = fetchContributionData(username, token);
  const entry: Entry = { promise, ts: Date.now() };
  cache.set(username, entry);

  promise
    .then((result) => {
      if (result.error && cache.get(username) === entry) cache.delete(username);
    })
    .catch(() => {
      if (cache.get(username) === entry) cache.delete(username);
    });

  return promise;
}

export function _resetForTest(): void {
  cache.clear();
}
