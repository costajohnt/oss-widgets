import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { renderTopReposCard } from '../../lib/svg-top-repos.js';

const DEFAULT_MIN_STARS = 50;

export default createWidgetHandler({
  prefix: 'top-repos',
  errorWidth: 495,
  errorHeight: 80,
  errorTextY: 45,
  render: renderTopReposCard,
  cacheKeyParams: ['minStars'],
  transform: (data, query) => {
    const parsed = typeof query.minStars === 'string' ? parseInt(query.minStars, 10) : NaN;
    const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

    const filtered = data.topRepos
      .filter((r) => (data.repoStars[r.repo] ?? 0) >= minStars)
      .slice(0, 8);

    return { ...data, topRepos: filtered };
  },
});
