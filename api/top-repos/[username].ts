import { createWidgetHandler } from '../../lib/endpoint-handler.js';
import { renderTopReposCard } from '../../lib/svg-top-repos.js';

export default createWidgetHandler({
  prefix: 'top-repos',
  errorWidth: 495,
  errorHeight: 80,
  errorTextY: 45,
  render: renderTopReposCard,
});
