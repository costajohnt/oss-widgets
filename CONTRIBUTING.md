# Contributing

Thanks for your interest in contributing to oss-widgets!

## Getting started

```bash
git clone https://github.com/costajohnt/oss-widgets.git
cd oss-widgets
pnpm install
```

### Local development

```bash
vercel dev          # Starts local dev server (requires Vercel CLI)
pnpm test           # Run all tests
pnpm run test:watch # Watch mode
pnpm run typecheck  # TypeScript strict mode check
```

You'll need a `GITHUB_TOKEN` environment variable for the endpoints to work locally. Create a `.env.local` file:

```
GITHUB_TOKEN=ghp_your_token_here
```

A classic PAT with no special scopes works (public data only).

## Adding a new widget

1. Create a renderer in `lib/svg-{name}.ts` following the pattern in `svg-card.ts`
2. Create an endpoint in `api/{name}/[username].ts` using `createWidgetHandler`
3. Add tests in `lib/svg-{name}.test.ts`
4. Update README.md with usage examples

The `createWidgetHandler` factory handles caching, timeouts, error SVGs, and theme support. Your renderer just needs to accept `ContributionData` and a `ThemeMode` and return an SVG string.

If your widget needs additional data (like star counts), see `api/top-repos/[username].ts` for an example of a standalone handler.

## Code style

- TypeScript strict mode, ESM modules
- All user-controllable strings must be escaped with `escapeXml()` before SVG rendering
- Tests co-located with source in `lib/`
- No `any` in production code

## Pull requests

- One feature or fix per PR
- Include tests for new functionality
- Run `pnpm test && pnpm run typecheck` before submitting
