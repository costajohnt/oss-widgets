import { Octokit } from '@octokit/rest';
import { isValidUsername, extractRepo } from '../../lib/github-data.js';
import { getStarsForRepos } from '../../lib/github-stars.js';
import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';

/** Minimum star count for a repo's PRs to be included — filters out personal/trivial repos. */
const DEFAULT_MIN_STARS = 50;

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

interface PRItem {
  repository_url: string;
}

/** Fetch all PR items for a search query (up to 1000, GitHub's limit). */
export async function fetchAllPRs(octokit: Octokit, query: string): Promise<PRItem[]> {
  const items: PRItem[] = [];
  let page = 1;
  while (true) {
    const { data } = await octokit.search.issuesAndPullRequests({
      q: query,
      per_page: 100,
      page,
    });
    items.push(...data.items);
    // Cap at 10 pages (= 1000 items, matching GitHub's search result limit)
    if (items.length >= data.total_count || items.length >= 1000 || data.items.length === 0) break;
    page++;
  }
  return items;
}

/** Compute badge data by fetching PR stats from GitHub API. */
export async function computeBadge(username: string, minStars: number): Promise<BadgeResponse> {
  if (!process.env.GITHUB_TOKEN) {
    return errorBadge('server config error');
  }
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  // Fetch all three categories excluding user's own repos
  const baseQuery = `is:pr author:${username} -user:${username}`;

  const [mergedItems, closedItems, openItems] = await Promise.all([
    fetchAllPRs(octokit, `${baseQuery} is:merged`),
    fetchAllPRs(octokit, `${baseQuery} is:closed is:unmerged`),
    fetchAllPRs(octokit, `${baseQuery} is:open`),
  ]);

  // Collect unique repos across all PRs
  const allItems = [...mergedItems, ...closedItems, ...openItems];
  const uniqueRepos = [...new Set(allItems.map((item) => extractRepo(item.repository_url)))];

  // Fetch star counts for all unique repos (parallelized, with 24hr caching)
  const repoStarsMap = await getStarsForRepos(octokit, uniqueRepos);

  // Filter qualifying repos
  const qualifyingRepos = new Set(uniqueRepos.filter((repo) => (repoStarsMap.get(repo) ?? 0) >= minStars));

  // Count PRs only from qualifying repos
  const mergedCount = mergedItems.filter((item) => qualifyingRepos.has(extractRepo(item.repository_url))).length;
  const closedCount = closedItems.filter((item) => qualifyingRepos.has(extractRepo(item.repository_url))).length;
  const openCount = openItems.filter((item) => qualifyingRepos.has(extractRepo(item.repository_url))).length;

  const total = mergedCount + closedCount;
  // mergeRate here is 0-1, unlike ContributionData.mergeRate which is 0-100
  const mergeRate = total > 0 ? mergedCount / total : 0;
  const mergeRatePct = `${(mergeRate * 100).toFixed(0)}%`;

  if (mergedCount === 0 && openCount === 0) {
    return { schemaVersion: 1, label: 'OSS Contributions', message: 'Getting Started', color: 'blue' };
  }

  return {
    schemaVersion: 1,
    label: 'OSS Contributions',
    message: `${mergeRatePct} merge rate | ${mergedCount} merged | ${openCount} open`,
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

  const parsed = typeof minStarsParam === 'string' ? parseInt(minStarsParam, 10) : NaN;
  const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

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

    badgeCache.set(cacheKey, { badge: result, ts: Date.now() });
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
