# CI + GitHub Pages (screenshots fixture & PR previews)

`.github/workflows/ci.yml` runs the Playwright suite and publishes the app **and** the standing
`screenshots/` fixture to a `gh-pages` branch that GitHub Pages serves.

## What it publishes

| Trigger | Where on gh-pages | URL |
|---|---|---|
| push to `main` | root: app at `/`, fixture at `/screenshots/` | `https://gregory-marton.github.io/Tonncade/` and `…/screenshots/` |
| pull request | `/previews/pr-<N>/` (that PR's app + fixture) | `…/Tonncade/previews/pr-<N>/` and `…/previews/pr-<N>/screenshots/` |
| PR closed | its `/previews/pr-<N>/` is pruned | — |

The suite runs all four device profiles (Desktop, Android, Tablet, iOS/Safari). WebKit runs
headless on the Linux runner — it's Playwright's cross-platform WebKit build, not Safari.app.
Browser availability is gated in `playwright.config.js`, so a run (or a contributor) missing a
browser just skips that profile with a warning.

The Playwright HTML report is uploaded as a build **artifact** (`playwright-report`) on every run
for debugging failures.

## One-time setup (do this once, after the first successful `main` run)

The app is currently served from `main`/root (`build_type: legacy`). The workflow keeps `gh-pages`
in sync with `main` (app at root) **plus** the generated fixtures — but Pages won't serve it until
you point Pages at the branch:

1. **Land the workflow on `main`.** The push-to-`main` run creates `gh-pages` and populates its
   root with the app + `/screenshots/`. ⚠️ Do this *before* step 2 — switching Pages to an empty
   `gh-pages` would take the live app down until the first build finishes.
2. **Settings → Pages → Build and deployment → Source: _Deploy from a branch_ → `gh-pages` / `/`
   (root).** The app URL is unchanged (`…github.io/Tonncade/`); only the serving branch changes,
   and CI keeps that branch's root identical to `main`.

After that, every `main` push refreshes the app + `/screenshots/`, and every PR gets a
`/previews/pr-<N>/` link commented on it (comparable against `/screenshots/`).

## Notes / limitations

- **Fork PRs** can't write to `gh-pages` or comment with the default `GITHUB_TOKEN` (by design —
  a fork's token is read-only). Previews therefore work for branches in this repo, not external
  forks; the workflow degrades gracefully (the comment step is non-fatal).
- The fixture's `*.png` / `manifest-*.js` stay **gitignored** — CI regenerates them into
  `gh-pages`, so `main`'s history never accumulates screenshots.
- The app uses relative asset paths (it already runs under the `/Tonncade/` subpath), so it also
  works under `/previews/pr-<N>/`.
- Concurrency is serialized (`gh-pages-publish`) so simultaneous runs don't clobber each other's
  push; pushes retry with `--rebase` on contention.
