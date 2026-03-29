# oss-widgets

[![CI](https://github.com/costajohnt/oss-widgets/actions/workflows/ci.yml/badge.svg)](https://github.com/costajohnt/oss-widgets/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Live SVG widgets for GitHub contribution stats. Embed auto-updating stats in your GitHub profile README or any Markdown surface.

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://oss-widgets.vercel.app/api/card/costajohnt?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://oss-widgets.vercel.app/api/card/costajohnt?theme=light" />
  <img alt="OSS Stats" src="https://oss-widgets.vercel.app/api/card/costajohnt?theme=dark" />
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://oss-widgets.vercel.app/api/activity/costajohnt?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://oss-widgets.vercel.app/api/activity/costajohnt?theme=light" />
  <img alt="Activity Graph" src="https://oss-widgets.vercel.app/api/activity/costajohnt?theme=dark" />
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://oss-widgets.vercel.app/api/top-repos/costajohnt?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://oss-widgets.vercel.app/api/top-repos/costajohnt?theme=light" />
  <img alt="Top Contributed Repos" src="https://oss-widgets.vercel.app/api/top-repos/costajohnt?theme=dark" />
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://oss-widgets.vercel.app/api/recent/costajohnt?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://oss-widgets.vercel.app/api/recent/costajohnt?theme=light" />
  <img alt="Recent Contributions" src="https://oss-widgets.vercel.app/api/recent/costajohnt?theme=dark" />
</picture>

</div>

## Widgets

### Stats Card

Shows merged PR count, merge rate, repo count, current streak, and a 12-week sparkline.

```markdown
[![OSS Contributions](https://oss-widgets.vercel.app/api/card/YOUR_USERNAME)](https://github.com/YOUR_USERNAME)
```

### Top Contributed Repos

Shows your top 8 external repos (excluding your own) sorted by merged PR count in the last 12 months.

```markdown
![Top Repos](https://oss-widgets.vercel.app/api/top-repos/YOUR_USERNAME)
```

### Recent Contributions

Shows your five most recently merged PRs with repo name and time-ago.

```markdown
![Recent](https://oss-widgets.vercel.app/api/recent/YOUR_USERNAME)
```

### Activity Graph

Shows a 26-week contribution heatmap with intensity-based coloring.

```markdown
![Activity](https://oss-widgets.vercel.app/api/activity/YOUR_USERNAME)
```

### Shields.io Badge

```markdown
![OSS Contributions](https://img.shields.io/endpoint?url=https://oss-widgets.vercel.app/api/badge/YOUR_USERNAME)
```

The badge shows merge rate, merged count, and open PR count. Only counts PRs to external repos with 50+ stars by default.

## Options

| Parameter | Values | Description |
|-----------|--------|-------------|
| `theme` | `light` (default), `dark` | Color scheme (card, recent, activity, top-repos) |
| `cache` | `no` | Bypass the 1-hour in-memory cache |
| `minStars` | number (default: `50`) | Minimum repo star count (badge + top-repos) |

### Dark mode with `<picture>` tags

For GitHub profile READMEs that respect the viewer's theme preference:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://oss-widgets.vercel.app/api/card/YOUR_USERNAME?theme=dark" />
  <source media="(prefers-color-scheme: light)" srcset="https://oss-widgets.vercel.app/api/card/YOUR_USERNAME?theme=light" />
  <img alt="OSS Stats" src="https://oss-widgets.vercel.app/api/card/YOUR_USERNAME?theme=dark" />
</picture>
```

## Caching

- **CDN:** 1 hour max-age + 10 min stale-while-revalidate (configured in `vercel.json`)
- **In-memory:** 1 hour TTL with 24-hour stale fallback
- **Cache bypass:** Append `?cache=no` to any endpoint
- **Error responses:** Badge errors are not cached at the CDN level (`no-cache, no-store`)

## Self-hosting

Deploy your own instance to Vercel:

1. Fork this repo
2. Create a Vercel project linked to your fork
3. Add a `GITHUB_TOKEN` environment variable — a classic PAT with no special scopes works (the GitHub Search API only needs public data access). Note: `gh auth token` OAuth tokens (`gho_*`) do not work from Vercel; use a `ghp_*` PAT.
4. Deploy

## Development

```bash
pnpm install       # Install dependencies
pnpm test          # Run all tests (102 tests across 8 files)
pnpm run typecheck # TypeScript check
vercel dev         # Local dev server
```

### Project structure

```
api/
├── card/[username].ts      # Stats card endpoint
├── recent/[username].ts    # Recent contributions endpoint
├── activity/[username].ts  # Activity graph endpoint
├── top-repos/[username].ts # Top contributed repos endpoint
└── badge/[username].ts     # Shields.io badge endpoint (JSON, standalone)
lib/
├── endpoint-handler.ts     # Shared handler factory (cache, timeout, error SVGs)
├── github-data.ts          # GitHub API data fetching + types
├── svg-card.ts             # Stats card SVG renderer
├── svg-top-repos.ts        # Top contributed repos SVG renderer
├── svg-recent.ts           # Recent contributions SVG renderer
├── svg-activity.ts         # Activity graph SVG renderer
├── svg-utils.ts            # Shared SVG utilities (themes, icons, escaping)
├── vercel-types.ts         # Shared Vercel request/response shims
└── *.test.ts               # Co-located tests
```

The card, recent, activity, and top-repos endpoints use the shared `createWidgetHandler` factory. The badge endpoint is standalone because it returns JSON (Shields.io format) rather than SVG.

## License

MIT

---

Originally extracted from [oss-autopilot](https://github.com/costajohnt/oss-autopilot).
