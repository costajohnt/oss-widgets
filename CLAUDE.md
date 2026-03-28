# CLAUDE.md

## Project Overview

oss-widgets is a standalone Vercel deployment serving live SVG widgets for GitHub contribution stats. Any GitHub user can embed these widgets in their profile README or any Markdown surface.

## Architecture

5 Vercel serverless function endpoints in `api/`, backed by shared renderers in `lib/`:

- `/api/card/[username]` — Stats card (merged PRs, merge rate, repos, streak, sparkline)
- `/api/recent/[username]` — Recent 5 merged PRs
- `/api/activity/[username]` — 26-week contribution heatmap
- `/api/top-repos/[username]` — Top 8 external repos by merged PR count
- `/api/badge/[username]` — Shields.io JSON badge endpoint (standalone, returns JSON not SVG)

Key modules in `lib/`:
- `endpoint-handler.ts` — Factory with in-memory cache (1hr TTL, 24hr stale fallback), error SVGs, theme support
- `github-data.ts` — Octokit-based GitHub Search API data fetcher, types (`ContributionData`, `ThemeMode`)
- `svg-card.ts`, `svg-recent.ts`, `svg-activity.ts`, `svg-top-repos.ts` — Pure SVG string renderers
- `svg-utils.ts` — Shared theme colors, SVG wrapper, icons, utilities
- `vercel-types.ts` — Shared Vercel request/response type shims

## Tech Stack

TypeScript (ESM), Vercel serverless functions, `@octokit/rest` for GitHub API, vitest for testing, pnpm.

## Development Commands

```bash
pnpm install          # Install dependencies
pnpm test             # Run all tests
pnpm run test:watch   # Watch mode
pnpm run typecheck    # TypeScript check
vercel dev            # Local development server
```

## Deployment

Deployed to Vercel. Requires `GITHUB_TOKEN` environment variable in Vercel project settings.

## Code Style

- No build step — Vercel compiles TypeScript directly
- Tests co-located with source in `lib/` and `api/badge/`
- All endpoints support `?theme=dark|light` and `?cache=no` query params
