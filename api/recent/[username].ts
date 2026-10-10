import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { parseMinStars } from '../../lib/min-stars.js';
import { renderRecentCard } from '../../lib/svg-recent.js';

export default createWidgetHandler({
  prefix: 'recent',
  errorWidth: 495,
  errorHeight: 80,
  errorTextY: 45,
  render: renderRecentCard,
  cacheKeySuffix: (query) => `minStars=${parseMinStars(query.minStars)}`,
  transform: (data, query) => {
    const minStars = parseMinStars(query.minStars);
    // Filter the full merge-date-sorted list first, then take 5, so low-star
    // repos never crowd out older qualifying PRs.
    const recentPRs = data.externalMergedPRs.filter((pr) => (data.repoStars[pr.repo] ?? 0) >= minStars).slice(0, 5);
    return { ...data, recentPRs };
  },
});
