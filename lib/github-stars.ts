import { Octokit } from '@octokit/rest';

/** In-memory cache for repo star counts (survives across warm invocations). */
const starCache = new Map<string, { stars: number; ts: number }>();
const STAR_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/** Fetch star count for a repo, with 24-hour in-memory caching. */
export async function getRepoStars(octokit: Octokit, owner: string, repo: string): Promise<number> {
  const key = `${owner}/${repo}`;
  const cached = starCache.get(key);
  if (cached && Date.now() - cached.ts < STAR_CACHE_TTL) return cached.stars;

  const { data } = await octokit.repos.get({ owner, repo });
  starCache.set(key, { stars: data.stargazers_count, ts: Date.now() });
  return data.stargazers_count;
}

/** Batch-fetch star counts for multiple repos, returning a map of repo → stars. */
export async function getStarsForRepos(
  octokit: Octokit,
  repos: string[],
  batchSize = 10,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (let i = 0; i < repos.length; i += batchSize) {
    const batch = repos.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (repo) => {
        const parts = repo.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.warn(`[stars] Malformed repo name: ${repo}`);
          return { repo, stars: 0 };
        }
        const [owner, name] = parts;
        try {
          return { repo, stars: await getRepoStars(octokit, owner, name) };
        } catch (err: unknown) {
          const status = err instanceof Object && 'status' in err ? (err as { status: number }).status : undefined;
          if (status !== 404) {
            console.warn(`[stars] Failed to fetch stars for ${repo}:`, err instanceof Error ? err.message : String(err));
          }
          // Private/deleted repos (404) or other errors — exclude from star count
          return { repo, stars: 0 };
        }
      }),
    );
    for (const { repo, stars } of results) {
      result.set(repo, stars);
    }
  }
  return result;
}

/** Clear the star cache (for testing). */
export function clearStarCache(): void {
  starCache.clear();
}
