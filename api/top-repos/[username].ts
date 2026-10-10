import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { parseMinStars } from '../../lib/min-stars.js';
import { renderTopReposCard } from '../../lib/svg-top-repos.js';

export default createWidgetHandler({
  prefix: 'top-repos',
  errorWidth: 495,
  errorHeight: 80,
  errorTextY: 45,
  render: renderTopReposCard,
  cacheKeySuffix: (query) => `minStars=${parseMinStars(query.minStars)}`,
  transform: (data, query) => {
    const minStars = parseMinStars(query.minStars);

    const filtered = data.topRepos
      .filter((r) => (data.repoStars[r.repo] ?? 0) >= minStars)
      .slice(0, 8);

    return { ...data, topRepos: filtered };
  },
});
