import {
  fetchContributionData,
  isValidUsername,
  type ContributionData,
  type ContributionResult,
  type ThemeMode,
} from './github-data.js';
import { escapeXml, theme as getTheme } from './svg-utils.js';
import type { VercelRequest, VercelResponse } from './vercel-types.js';

const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const STALE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const TIMEOUT_MS = 25_000;

interface CacheEntry {
  svg: string;
  ts: number;
}

export interface WidgetHandlerConfig {
  /** Short name used for the per-widget in-memory cache key namespace. */
  prefix: string;
  errorWidth: number;
  errorHeight: number;
  errorTextY: number;
  render: (data: ContributionData, mode: ThemeMode) => string;
}

function makeErrorSvg(message: string, mode: ThemeMode, config: WidgetHandlerConfig): string {
  const { errorWidth: width, errorHeight: height, errorTextY: textY } = config;
  const t = getTheme(mode);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
  <rect width="${width}" height="${height}" rx="8" fill="${t.bg}" stroke="${t.border}" stroke-width="1"/>
  <text x="${Math.round(width / 2)}" y="${textY}" font-family="system-ui,sans-serif" font-size="13" fill="${t.text}" text-anchor="middle">${escapeXml(message)}</text>
</svg>`;
}

export function createWidgetHandler(config: WidgetHandlerConfig) {
  const { prefix, render } = config;
  const cache = new Map<string, CacheEntry>();

  function errorSvg(message: string, mode: ThemeMode): string {
    return makeErrorSvg(message, mode, config);
  }

  return async function handler(req: VercelRequest, res: VercelResponse) {
    const { username, theme: themeParam, cache: cacheParam } = req.query;

    const mode = (themeParam === 'dark' ? 'dark' : 'light') satisfies ThemeMode;
    const noCache = cacheParam === 'no';

    res.setHeader('Content-Type', 'image/svg+xml');
    // Cache-Control is set by vercel.json at the CDN edge layer

    if (typeof username !== 'string' || !isValidUsername(username)) {
      return res.status(400).send(errorSvg('Invalid GitHub username', mode));
    }

    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).send(errorSvg('Server configuration error: missing GitHub token', mode));
    }

    const cacheKey = `${prefix}:${username}:${mode}`;

    if (!noCache) {
      const cached = cache.get(cacheKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return res.status(200).send(cached.svg);
      }
    }

    const computation = fetchContributionData(username, process.env.GITHUB_TOKEN);
    computation.catch((err) => {
      console.error(`[${prefix}] Post-timeout error for ${username}:`, err instanceof Error ? err.message : String(err));
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let result: ContributionResult;
    try {
      result = await Promise.race([
        computation,
        new Promise<ContributionResult>((resolve) => {
          timer = setTimeout(() => resolve({ error: 'timeout' as const }), TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (result.error) {
      // Try stale fallback before returning an error SVG
      const stale = cache.get(cacheKey);
      if (stale && Date.now() - stale.ts < STALE_TTL) {
        console.warn(`[${prefix}] Serving stale cache for ${username}: ${result.error}`);
        return res.status(200).send(stale.svg);
      }

      if (result.error === 'user_not_found') {
        return res.status(404).send(errorSvg(`GitHub user "${username}" not found`, mode));
      }
      if (result.error === 'rate_limited') {
        return res.status(429).send(errorSvg('GitHub API rate limit reached — try again later', mode));
      }
      if (result.error === 'timeout') {
        return res.status(504).send(errorSvg('Request timed out — try again later', mode));
      }
      return res.status(502).send(errorSvg('GitHub API error — try again later', mode));
    }

    let svg: string;
    try {
      svg = render(result, mode);
    } catch (err) {
      console.error(`[${prefix}] Render failed for ${username}:`, err instanceof Error ? err.message : String(err));
      return res.status(500).send(makeErrorSvg('Render error', mode, config));
    }
    cache.set(cacheKey, { svg, ts: Date.now() });
    return res.status(200).send(svg);
  };
}
