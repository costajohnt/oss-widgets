import { Octokit } from '@octokit/rest';
import { fetchContributionData, isValidUsername, type ThemeMode } from '../../lib/github-data.js';
import { getStarsForRepos } from '../../lib/github-stars.js';
import { renderRecentCard } from '../../lib/svg-recent.js';
import { escapeXml, theme as getTheme } from '../../lib/svg-utils.js';
import type { VercelRequest, VercelResponse } from '../../lib/vercel-types.js';

const DEFAULT_MIN_STARS = 50;
const CACHE_TTL = 60 * 60 * 1000;
const STALE_TTL = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 25_000;

interface CacheEntry {
  svg: string;
  ts: number;
}

const cache = new Map<string, CacheEntry>();

function errorSvg(message: string, mode: ThemeMode): string {
  const t = getTheme(mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="80" viewBox="0 0 495 80" fill="none">
  <rect width="495" height="80" rx="8" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>
  <text x="248" y="45" font-family="system-ui,sans-serif" font-size="13" fill="${t.text}" text-anchor="middle">${escapeXml(message)}</text>
</svg>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { username, theme: themeParam, cache: cacheParam, minStars: minStarsParam } = req.query;

  const mode = (themeParam === 'dark' ? 'dark' : 'light') satisfies ThemeMode;
  const noCache = cacheParam === 'no';
  const parsed = typeof minStarsParam === 'string' ? parseInt(minStarsParam, 10) : NaN;
  const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

  res.setHeader('Content-Type', 'image/svg+xml');

  if (typeof username !== 'string' || !isValidUsername(username)) {
    return res.status(400).send(errorSvg('Invalid GitHub username', mode));
  }

  if (!process.env.GITHUB_TOKEN) {
    return res.status(500).send(errorSvg('Server configuration error: missing GitHub token', mode));
  }

  const cacheKey = `recent:${username}:${mode}:${minStars}`;

  if (!noCache) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      return res.status(200).send(cached.svg);
    }
  }

  const computation = (async () => {
    const result = await fetchContributionData(username, process.env.GITHUB_TOKEN!);
    if (result.error) return { error: result.error };

    // Fetch star counts for repos in recentPRs to enable minStars filtering
    const repoNames = [...new Set(result.recentPRs.map((pr) => pr.repo))];
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const starsMap = await getStarsForRepos(octokit, repoNames);

    const filtered = result.recentPRs.filter((pr) => (starsMap.get(pr.repo) ?? 0) >= minStars);

    return { ...result, recentPRs: filtered };
  })();

  computation.catch((err) => {
    console.error(`[recent] Post-timeout error for ${username}:`, err instanceof Error ? err.message : String(err));
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let outcome: Awaited<typeof computation> | 'timeout';
  try {
    outcome = await Promise.race([
      computation,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (outcome === 'timeout' || (typeof outcome === 'object' && 'error' in outcome && outcome.error)) {
    const stale = cache.get(cacheKey);
    if (stale && Date.now() - stale.ts < STALE_TTL) {
      const reason = outcome === 'timeout' ? 'timeout' : (outcome as { error: string }).error;
      console.warn(`[recent] Serving stale cache for ${username}: ${reason}`);
      return res.status(200).send(stale.svg);
    }
    if (outcome === 'timeout') {
      return res.status(504).send(errorSvg('Request timed out — try again later', mode));
    }
    const err = (outcome as { error: string }).error;
    if (err === 'user_not_found') return res.status(404).send(errorSvg(`GitHub user "${username}" not found`, mode));
    if (err === 'rate_limited') return res.status(429).send(errorSvg('GitHub API rate limit reached — try again later', mode));
    return res.status(502).send(errorSvg('GitHub API error — try again later', mode));
  }

  const svg = renderRecentCard(outcome, mode);
  cache.set(cacheKey, { svg, ts: Date.now() });
  return res.status(200).send(svg);
}
