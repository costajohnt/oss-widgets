import type { ContributionData, ThemeMode } from './github-data.js';
import { crystalIcon, svgWrapper, theme, REPO_COLORS, truncate, escapeXml } from './svg-utils.js';

const WIDTH = 495;
const ROW_H = 32;
const HEADER_H = 44;
const FOOTER_PAD = 12;
const MAX_ROWS = 8;

export function renderTopReposCard(data: ContributionData, mode: ThemeMode): string {
  const t = theme(mode);
  const repos = data.topRepos.slice(0, MAX_ROWS);

  const HEIGHT = HEADER_H + Math.max(repos.length, 1) * ROW_H + FOOTER_PAD;

  const iconSize = 20;
  const iconX = 14;
  const iconY = 12;

  const header = [
    `<g transform="translate(${iconX},${iconY})">${crystalIcon(iconSize)}</g>`,
    `<text x="${iconX + iconSize + 8}" y="${iconY + 14}" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="${t.text}">Top Contributed Repos</text>`,
  ].join('\n  ');

  let rows: string;

  if (repos.length === 0) {
    const cy = HEADER_H + ROW_H / 2 + 6;
    rows = `<text x="${WIDTH / 2}" y="${cy}" font-family="system-ui,sans-serif" font-size="12" fill="${t.textSecondary}" text-anchor="middle">No external contributions</text>`;
  } else {
    rows = repos
      .map((entry, i) => {
        const color = REPO_COLORS[i % REPO_COLORS.length];
        const y = HEADER_H + i * ROW_H;
        const barX = 14;
        const barY = y + 7;
        const barW = 3;
        const barH = ROW_H - 14;

        const repoName = escapeXml(truncate(entry.repo, 38));
        const countLabel = `${entry.count} PR${entry.count !== 1 ? 's' : ''}`;

        return [
          `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="1.5" fill="${color}"/>`,
          `<text x="${barX + barW + 8}" y="${y + 20}" font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="${t.text}">${repoName}</text>`,
          `<text x="${WIDTH - 14}" y="${y + 20}" font-family="system-ui,sans-serif" font-size="11" fill="${color}" text-anchor="end">${countLabel}</text>`,
        ].join('\n  ');
      })
      .join('\n  ');
  }

  const content = [header, rows].join('\n  ');
  return svgWrapper(WIDTH, HEIGHT, content, mode);
}
