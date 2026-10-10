import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { computeStreak } from '../../lib/github-data.js';
import { parseMinStars, qualifyingStats } from '../../lib/min-stars.js';
import { renderStatsCard } from '../../lib/svg-card.js';

export default createWidgetHandler({
  prefix: 'card',
  errorWidth: 495,
  errorHeight: 195,
  errorTextY: 100,
  render: renderStatsCard,
  cacheKeySuffix: (query) => `minStars=${parseMinStars(query.minStars)}`,
  transform: (data, query) => {
    // Every number on the card describes the same population: PRs to external
    // repos with at least minStars stars (matching the badge).
    const stats = qualifyingStats(data, parseMinStars(query.minStars));

    const dailyActivity: Record<string, number> = {};
    for (const pr of stats.mergedPRs) {
      if (!pr.mergedAt) continue;
      const day = pr.mergedAt.slice(0, 10);
      dailyActivity[day] = (dailyActivity[day] ?? 0) + 1;
    }

    return {
      ...data,
      merged: stats.merged,
      open: stats.open,
      closedUnmerged: stats.closedUnmerged,
      mergeRate: stats.mergeRate,
      repoCount: stats.topRepos.length,
      cappedMerged: false,
      topRepos: stats.topRepos,
      dailyActivity,
      streak: computeStreak(dailyActivity),
    };
  },
});
