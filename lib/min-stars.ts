import type { ContributionData, RecentPR } from './github-data.js';

/** Minimum star count for a repo's PRs to be included; filters out personal/trivial repos. */
export const DEFAULT_MIN_STARS = 50;

/**
 * Parse the `minStars` query param. Non-numeric or missing values fall back to
 * DEFAULT_MIN_STARS; negatives clamp to 0. Callers use the parsed number (not
 * the raw string) in cache keys so `1`, `01` and `1x` share one entry.
 */
export function parseMinStars(value: unknown): number {
  const parsed = typeof value === 'string' ? parseInt(value, 10) : NaN;
  return Number.isNaN(parsed) ? DEFAULT_MIN_STARS : Math.max(0, parsed);
}

export interface QualifyingStats {
  merged: number;
  closedUnmerged: number;
  open: number;
  /** Merge rate as a percentage (0-100). */
  mergeRate: number;
  /** Qualifying repos with merged PRs, sorted by merged count descending. */
  topRepos: { repo: string; count: number }[];
  /** Qualifying merged PRs, most recently merged first. */
  mergedPRs: RecentPR[];
}

/**
 * Counts restricted to one population: PRs to external repos (not owned by
 * the user) with at least `minStars` stars. Every number on the card and the
 * badge comes from this, so merged, closed, open and the merge rate always
 * describe the same set of PRs.
 */
export function qualifyingStats(data: ContributionData, minStars: number): QualifyingStats {
  const qualifies = (repo: string) => (data.repoStars[repo] ?? 0) >= minStars;
  const sumQualifying = (byRepo: Readonly<Record<string, number>>) =>
    Object.entries(byRepo).reduce((sum, [repo, count]) => (qualifies(repo) ? sum + count : sum), 0);

  const topRepos = data.topRepos.filter((r) => qualifies(r.repo));
  const merged = topRepos.reduce((sum, r) => sum + r.count, 0);
  const closedUnmerged = sumQualifying(data.externalClosedUnmergedByRepo);
  const open = sumQualifying(data.externalOpenByRepo);
  const total = merged + closedUnmerged;

  return {
    merged,
    closedUnmerged,
    open,
    mergeRate: total > 0 ? (merged / total) * 100 : 0,
    topRepos,
    mergedPRs: data.externalMergedPRs.filter((pr) => qualifies(pr.repo)),
  };
}
