import { isValidUsername, type ContributionError } from '../../lib/github-data.js';
import { getContributionData } from '../../lib/contribution-cache.js';
import { parseMinStars, qualifyingStats } from '../../lib/min-stars.js';
import { setBounded } from '../../lib/bounded-map.js';
import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';

const FUNCTION_TIMEOUT_MS = 25_000;

export type ShieldsColor = 'brightgreen' | 'green' | 'yellow' | 'orange' | 'lightgrey' | 'blue';

export interface BadgeResponse {
  schemaVersion: 1;
  label: string;
  message: string;
  color: ShieldsColor;
}

export function errorBadge(message: string): BadgeResponse {
  return { schemaVersion: 1, label: 'OSS Contributions', message, color: 'lightgrey' };
}

export function pickColor(mergeRate: number): ShieldsColor {
  if (mergeRate >= 0.8) return 'brightgreen';
  if (mergeRate >= 0.6) return 'green';
  if (mergeRate >= 0.4) return 'yellow';
  return 'orange';
}

/** In-memory cache for full badge results. */
export const badgeCache = new Map<string, { badge: BadgeResponse; ts: number }>();
const BADGE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const STALE_BADGE_TTL = 24 * 60 * 60 * 1000; // 24 hours — fallback during timeouts/errors
/** Cap on cached badges per instance; oldest entries are evicted first. */
const MAX_BADGE_CACHE_ENTRIES = 500;

/**
 * Compute badge data from the shared contribution data (GraphQL, star counts
 * inline, cached per user across all widgets). Counts only PRs to external
 * repos with at least `minStars` stars in the 12-month window, plus open PRs
 * to those repos. Returns a ContributionError when the fetch failed.
 */
export async function computeBadge(username: string, minStars: number): Promise<BadgeResponse | ContributionError> {
  if (!process.env.GITHUB_TOKEN) {
    return errorBadge('server config error');
  }

  const data = await getContributionData(username, process.env.GITHUB_TOKEN);
  if (data.error) return data;

  const stats = qualifyingStats(data, minStars);
  // mergeRate here is 0-1, unlike ContributionData.mergeRate which is 0-100
  const mergeRate = stats.mergeRate / 100;
  // Capped fetches undercount: merged is a lower bound and the rate an estimate.
  const rateApprox = data.cappedMerged || data.cappedClosedUnmerged ? '~' : '';
  const mergeRatePct = `${rateApprox}${stats.mergeRate.toFixed(0)}%`;
  const mergedLabel = data.cappedMerged ? `${stats.merged}+` : `${stats.merged}`;

  if (stats.merged === 0 && stats.open === 0) {
    return { schemaVersion: 1, label: 'OSS Contributions', message: 'Getting Started', color: 'blue' };
  }

  return {
    schemaVersion: 1,
    label: 'OSS Contributions',
    message: `${mergeRatePct} merge rate | ${mergedLabel} merged | ${stats.open} open`,
    color: pickColor(mergeRate),
  };
}

/** Return stale cached badge if available (within STALE_BADGE_TTL), or an error badge. */
export function staleFallback(cacheKey: string, reason: string): BadgeResponse {
  const stale = badgeCache.get(cacheKey);
  if (stale && Date.now() - stale.ts < STALE_BADGE_TTL) {
    console.warn(`[badge] Serving stale cache for ${cacheKey}: ${reason}`);
    return stale.badge;
  }
  return errorBadge('temporarily unavailable');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { username, minStars: minStarsParam } = req.query;

  if (typeof username !== 'string' || !isValidUsername(username)) {
    return res.status(200).json(errorBadge('invalid username'));
  }

  const minStars = parseMinStars(minStarsParam);

  const cacheKey = `${username}:${minStars}`;
  const cached = badgeCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BADGE_CACHE_TTL) {
    return res.status(200).json(cached.badge);
  }

  // Race the computation against a safety timeout (25s) before Vercel's 30s function limit.
  // Attach .catch() to prevent unhandled rejections if computeBadge throws after timeout.
  const computation = computeBadge(username, minStars);
  computation.catch((err) => {
    console.error('[badge] Post-timeout error for', username, err instanceof Error ? err.message : String(err));
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      computation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FUNCTION_TIMEOUT_MS);
      }),
    ]);

    if (result === null) {
      console.warn('[badge] Computation timed out for', username);
      // Don't cache error responses at the CDN level
      res.setHeader('Cache-Control', 'no-cache, no-store');
      return res.status(200).json(staleFallback(cacheKey, 'timeout'));
    }

    if ('error' in result && result.error) {
      res.setHeader('Cache-Control', 'no-cache, no-store');
      if (result.error === 'user_not_found') {
        return res.status(200).json(errorBadge('user not found'));
      }
      if (result.error === 'rate_limited') {
        console.warn('[badge] GitHub API rate limited for', username);
        return res.status(200).json(staleFallback(cacheKey, 'rate limited'));
      }
      return res.status(200).json(staleFallback(cacheKey, result.error));
    }

    setBounded(badgeCache, cacheKey, { badge: result, ts: Date.now() }, MAX_BADGE_CACHE_ENTRIES);
    return res.status(200).json(result);
  } catch (error: unknown) {
    const status = error instanceof Object && 'status' in error ? (error as { status: number }).status : undefined;
    if (status === 422) {
      return res.status(200).json(errorBadge('user not found'));
    }
    if (status === 403 || status === 429) {
      console.warn('[badge] GitHub API rate limited for', username);
      res.setHeader('Cache-Control', 'no-cache, no-store');
      return res.status(200).json(staleFallback(cacheKey, 'rate limited'));
    }
    console.error('[badge]', error instanceof Error ? error.message : String(error));
    res.setHeader('Cache-Control', 'no-cache, no-store');
    return res.status(200).json(staleFallback(cacheKey, 'error'));
  } finally {
    if (timer) clearTimeout(timer);
  }
}
