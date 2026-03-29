import { Octokit } from '@octokit/rest';
import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { getStarsForRepos } from '../../lib/github-stars.js';
import { renderStatsCard } from '../../lib/svg-card.js';

const DEFAULT_MIN_STARS = 50;

export default createWidgetHandler({
  prefix: 'card',
  errorWidth: 495,
  errorHeight: 195,
  errorTextY: 100,
  render: renderStatsCard,
  cacheKeyParams: ['minStars'],
  transform: async (data, query) => {
    const parsed = typeof query.minStars === 'string' ? parseInt(query.minStars, 10) : NaN;
    const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

    // Fetch star counts for repos in topRepos (already excludes own repos)
    const repoNames = data.topRepos.map((r) => r.repo);
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const starsMap = await getStarsForRepos(octokit, repoNames);

    // Filter topRepos by minStars and recalculate aggregates
    const qualifying = data.topRepos.filter((r) => (starsMap.get(r.repo) ?? 0) >= minStars);
    const filteredMerged = qualifying.reduce((sum, r) => sum + r.count, 0);

    return {
      ...data,
      merged: filteredMerged,
      repoCount: qualifying.length,
      cappedMerged: false,
      topRepos: qualifying,
    };
  },
});
