import { Octokit } from '@octokit/rest';
import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { getStarsForRepos } from '../../lib/github-stars.js';
import { renderRecentCard } from '../../lib/svg-recent.js';

const DEFAULT_MIN_STARS = 50;

export default createWidgetHandler({
  prefix: 'recent',
  errorWidth: 495,
  errorHeight: 80,
  errorTextY: 45,
  render: renderRecentCard,
  cacheKeyParams: ['minStars'],
  transform: async (data, query) => {
    const parsed = typeof query.minStars === 'string' ? parseInt(query.minStars, 10) : NaN;
    const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

    const repoNames = [...new Set(data.recentPRs.map((pr) => pr.repo))];
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    const starsMap = await getStarsForRepos(octokit, repoNames);

    const filtered = data.recentPRs.filter((pr) => (starsMap.get(pr.repo) ?? 0) >= minStars);

    return { ...data, recentPRs: filtered };
  },
});
