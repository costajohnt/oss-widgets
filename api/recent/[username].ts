import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { renderRecentCard } from '../../lib/svg-recent.js';

const DEFAULT_MIN_STARS = 50;

export default createWidgetHandler({
  prefix: 'recent',
  errorWidth: 495,
  errorHeight: 80,
  errorTextY: 45,
  render: renderRecentCard,
  cacheKeyParams: ['minStars'],
  transform: (data, query) => {
    const parsed = typeof query.minStars === 'string' ? parseInt(query.minStars, 10) : NaN;
    const minStars = Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);

    const filtered = data.recentPRs.filter((pr) => (data.repoStars[pr.repo] ?? 0) >= minStars);
    return { ...data, recentPRs: filtered };
  },
});
