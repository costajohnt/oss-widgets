import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { renderStatsCard } from '../../lib/svg-card.js';

const DEFAULT_MIN_STARS = 50;

export default createWidgetHandler({
  prefix: 'card',
  errorWidth: 495,
  errorHeight: 195,
  errorTextY: 100,
  render: renderStatsCard,
  cacheKeyParams: ['minStars'],
  transform: (data, query) => {
    const parsed = typeof query.minStars === 'string' ? parseInt(query.minStars, 10) : NaN;
    const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

    const qualifying = data.topRepos.filter((r) => (data.repoStars[r.repo] ?? 0) >= minStars);
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
