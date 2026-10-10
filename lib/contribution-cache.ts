import { fetchContributionData, type ContributionResult } from './github-data.js';
import { setBounded } from './bounded-map.js';

const TTL_MS = 60 * 60 * 1000;
/**
 * `force` (the public `?cache=no`) only refetches when the cached entry is at
 * least this old, so repeated forced requests cannot spend the server token
 * faster than once per user per window.
 */
export const FORCE_MIN_AGE_MS = 5 * 60 * 1000;
/** Cap on cached users per instance; oldest entries are evicted first. */
export const MAX_ENTRIES = 500;

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
  const existing = cache.get(username);
  if (existing) {
    const age = Date.now() - existing.ts;
    const maxAge = options.force ? FORCE_MIN_AGE_MS : TTL_MS;
    if (age < maxAge) {
      return existing.promise;
    }
  }

  const promise = fetchContributionData(username, token);
  const entry: Entry = { promise, ts: Date.now() };
  setBounded(cache, username, entry, MAX_ENTRIES);

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
