import { Octokit } from '@octokit/rest';

const USERNAME_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export interface RecentPR {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: string; // "owner/repo"
  readonly mergedAt: string; // ISO timestamp
}

export type ThemeMode = 'light' | 'dark';

export interface ContributionData {
  readonly merged: number;
  readonly open: number;
  readonly closedUnmerged: number;
  /** Merge rate as a percentage (0-100), not a ratio. */
  readonly mergeRate: number;
  readonly repoCount: number;
  readonly recentPRs: readonly RecentPR[];
  readonly cappedMerged: boolean;
  readonly cappedClosedUnmerged: boolean;
  /** Daily activity: map of "YYYY-MM-DD" → count of merged PRs */
  readonly dailyActivity: Record<string, number>;
  /** Consecutive calendar weeks (Mon-Sun, UTC) with at least one merged PR */
  readonly streak: number;
  /** Top external repos by merged PR count (excludes user's own repos), sorted descending. */
  readonly topRepos: readonly { repo: string; count: number }[];
  /** Star count per repo seen in merged PRs. Populated inline by the GraphQL fetch. */
  readonly repoStars: Readonly<Record<string, number>>;
  readonly error?: undefined;
}

export interface ContributionError {
  error: 'user_not_found' | 'rate_limited' | 'api_error' | 'timeout';
  merged?: undefined;
}

export type ContributionResult = ContributionData | ContributionError;

function twelveMonthsAgo(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function extractRepo(repositoryUrl: string): string {
  return repositoryUrl.replace('https://api.github.com/repos/', '');
}

export function computeStreak(dailyActivity: Record<string, number>): number {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const currentMonday = new Date(now);
  currentMonday.setUTCDate(now.getUTCDate() - mondayOffset);
  currentMonday.setUTCHours(0, 0, 0, 0);

  let streak = 0;
  const weekStart = new Date(currentMonday);

  for (let w = 0; w < 52; w++) {
    let hasActivity = false;
    for (let d = 0; d < 7; d++) {
      const checkDate = new Date(weekStart);
      checkDate.setUTCDate(weekStart.getUTCDate() + d);
      const key = checkDate.toISOString().slice(0, 10);
      if (dailyActivity[key] && dailyActivity[key] > 0) {
        hasActivity = true;
        break;
      }
    }
    if (hasActivity) {
      streak++;
    } else if (w === 0) {
      // Current week has no activity yet — still count prior weeks
    } else {
      break;
    }
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
  }

  return streak;
}

interface MergedPRItem {
  number: number;
  title: string;
  url: string;
  /** owner/repo */
  repo: string;
  mergedAt: string;
  stargazerCount: number;
}

interface GraphQLSearchResponse {
  search: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Array<{
      number: number;
      title: string;
      url: string;
      mergedAt: string;
      repository: { nameWithOwner: string; stargazerCount: number };
    }>;
  };
}

const MERGED_PR_QUERY = `
  query($q: String!, $after: String) {
    search(query: $q, type: ISSUE, first: 100, after: $after) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on PullRequest {
          number
          title
          url
          mergedAt
          repository { nameWithOwner stargazerCount }
        }
      }
    }
  }
`;

async function pageMergedPRs(
  octokit: InstanceType<typeof Octokit>,
  query: string,
  maxItems: number = 1000,
): Promise<{ totalCount: number; items: MergedPRItem[] }> {
  const items: MergedPRItem[] = [];
  let after: string | null = null;
  let totalCount = 0;

  for (let page = 0; page < 10; page++) {
    const res = (await octokit.graphql(MERGED_PR_QUERY, { q: query, after })) as GraphQLSearchResponse;
    if (page === 0) totalCount = res.search.issueCount;

    for (const n of res.search.nodes) {
      items.push({
        number: n.number,
        title: n.title,
        url: n.url,
        repo: n.repository.nameWithOwner,
        mergedAt: n.mergedAt,
        stargazerCount: n.repository.stargazerCount,
      });
    }

    if (!res.search.pageInfo.hasNextPage || items.length >= maxItems) break;
    after = res.search.pageInfo.endCursor;
  }

  return { totalCount, items };
}

/**
 * Paginate merged PRs via GraphQL with a two-pass union to defeat GitHub's
 * 1000-result Search cap. First pass sorts updated-desc; if items don't cover
 * totalCount, a second pass with updated-asc fetches the oldest-updated PRs
 * that fell off the cap. Results are deduped by URL. Effective ceiling: ~2000.
 */
async function paginateMergedPRsGraphQL(
  octokit: InstanceType<typeof Octokit>,
  baseQuery: string,
): Promise<{ totalCount: number; items: MergedPRItem[]; capped: boolean }> {
  const first = await pageMergedPRs(octokit, `${baseQuery} sort:updated-desc`);
  if (first.items.length >= first.totalCount) {
    return { totalCount: first.totalCount, items: first.items, capped: false };
  }

  const second = await pageMergedPRs(octokit, `${baseQuery} sort:updated-asc`);
  const seen = new Map<string, MergedPRItem>();
  for (const it of first.items) seen.set(it.url, it);
  for (const it of second.items) seen.set(it.url, it);
  const items = [...seen.values()];

  return {
    totalCount: first.totalCount,
    items,
    capped: items.length < first.totalCount,
  };
}

export async function fetchContributionData(username: string, token: string): Promise<ContributionResult> {
  const octokit = new Octokit({ auth: token });
  const since = twelveMonthsAgo();

  try {
    // Merged PRs via GraphQL (uses 5000/hour GraphQL bucket, not 30/min REST search bucket).
    // Open/closed-unmerged counts via REST (1 search call each, fits in budget).
    const [mergedResult, openRes, closedRes] = await Promise.all([
      paginateMergedPRsGraphQL(octokit, `is:pr author:${username} is:merged merged:>=${since}`),
      octokit.rest.search.issuesAndPullRequests({
        q: `is:pr author:${username} is:open`,
        sort: 'updated',
        order: 'desc',
        per_page: 1,
      }),
      octokit.rest.search.issuesAndPullRequests({
        q: `is:pr author:${username} is:unmerged is:closed closed:>=${since}`,
        sort: 'updated',
        order: 'desc',
        per_page: 1,
      }),
    ]);

    const merged = mergedResult.totalCount;
    const open = openRes.data.total_count;
    const closedUnmerged = closedRes.data.total_count;
    const mergeTotal = merged + closedUnmerged;
    const mergeRate = mergeTotal > 0 ? (merged / mergeTotal) * 100 : 0;

    const repoCounts = new Map<string, number>();
    const repoStars: Record<string, number> = {};
    const dailyActivity: Record<string, number> = {};
    const recentPRs: RecentPR[] = [];

    for (const item of mergedResult.items) {
      const repo = item.repo;
      repoCounts.set(repo, (repoCounts.get(repo) ?? 0) + 1);
      repoStars[repo] = item.stargazerCount;

      if (item.mergedAt) {
        const day = item.mergedAt.slice(0, 10);
        dailyActivity[day] = (dailyActivity[day] ?? 0) + 1;
      }

      const isOwnRepo = repo.split('/')[0].toLowerCase() === username.toLowerCase();
      if (!isOwnRepo && recentPRs.length < 5) {
        recentPRs.push({
          number: item.number,
          title: item.title,
          url: item.url,
          repo,
          mergedAt: item.mergedAt,
        });
      }
    }

    const topRepos = [...repoCounts.entries()]
      .filter(([repo]) => repo.split('/')[0].toLowerCase() !== username.toLowerCase())
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => b.count - a.count);

    return {
      merged,
      open,
      closedUnmerged,
      mergeRate,
      repoCount: repoCounts.size,
      recentPRs,
      cappedMerged: mergedResult.capped,
      cappedClosedUnmerged: closedUnmerged >= 1000,
      dailyActivity,
      streak: computeStreak(dailyActivity),
      topRepos,
      repoStars,
    };
  } catch (err: unknown) {
    const status = err instanceof Object && 'status' in err ? (err as { status: number }).status : undefined;
    if (status === 422) {
      return { error: 'user_not_found' };
    }
    if (status === 403 || status === 429) {
      console.warn('[widget] Rate limited for', username);
      return { error: 'rate_limited' };
    }
    console.error('[widget] API error for', username, err instanceof Error ? err.message : String(err));
    return { error: 'api_error' };
  }
}
