# oss-widgets

Live SVG widgets for GitHub contribution stats. Embed auto-updating stats in your GitHub profile README or any Markdown surface.

## Widgets

### Stats Card

Shows merged PR count, merge rate, repo count, current streak, and a 12-week sparkline.

```markdown
[![OSS Contributions](https://oss-widgets.vercel.app/api/card/YOUR_USERNAME)](https://github.com/YOUR_USERNAME)
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

## Options

| Parameter | Values | Description |
|-----------|--------|-------------|
| `theme` | `light` (default), `dark` | Color scheme |
| `cache` | `no` | Bypass the 1-hour in-memory cache |
| `minStars` | number (default: `50`) | Minimum repo star count (badge only) |

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

- **Browser/CDN:** 1 hour max-age + 10 min stale-while-revalidate
- **In-memory:** 1 hour TTL with 24-hour stale fallback
- **Cache bypass:** Append `?cache=no` to any endpoint

## Self-hosting

Deploy your own instance to Vercel:

1. Fork this repo
2. Create a Vercel project linked to your fork
3. Add a `GITHUB_TOKEN` environment variable (needs no special scopes — public repo access only)
4. Deploy

## Development

```bash
pnpm install       # Install dependencies
pnpm test          # Run all tests
pnpm run typecheck # TypeScript check
vercel dev         # Local dev server
```

## License

MIT

---

Originally extracted from [oss-autopilot](https://github.com/costajohnt/oss-autopilot).
