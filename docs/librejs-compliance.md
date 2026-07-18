# LibreJS Compliance

Tonncade is GPLv3, and every `.js` file carries a `@licstart`/`@licend` license notice (the
format [GNU LibreJS](https://www.gnu.org/software/librejs/) itself recognizes) so that
LibreJS-enabled browsers don't block the site's scripts as "nonfree."

## Checking compliance locally

`npm run test:librejs` runs the *real* LibreJS compliance tool — not a reimplementation of
its detection logic — against the local dev server, and reports PASS/FAIL by reading the
tool's own output.

Requirements:
- A sibling checkout of LibreJS itself (`https://github.com/gnu/librejs` or
  `git.savannah.gnu.org/git/librejs.git`), with `librejs.xpi` built (see that repo's
  `build.sh`) and its own `npm install` run (`selenium-webdriver` + `geckodriver`).
- Firefox installed locally.
- The local dev server running (`npx http-server -p 8001`, or whatever `playwright.config.js`
  points at).

By default the script looks for the LibreJS checkout at `../librejs` (a sibling of this repo)
and targets `http://localhost:8001`. Override either with environment variables:

```bash
LIBREJS_DIR=/path/to/librejs TARGET_URL=http://localhost:8001 npm run test:librejs
```

## Keeping `js/version.js` compliant

`js/version.js` is regenerated on every commit by the `pre-commit` git hook (it stamps the
current commit's short SHA). Since the whole file gets overwritten, the hook itself re-writes
the license notice every time rather than relying on it surviving in a file nothing else
touches. The hook lives at `githooks/pre-commit` (tracked, since `.git/hooks/` itself isn't
version-controlled) — either run `git config core.hooksPath githooks` once per clone, or copy
it to `.git/hooks/pre-commit` and `chmod +x` it.

## Adding a new JS file

Copy the `@licstart`/`@licend` block from any existing `js/*.js` file onto the new one before
its first commit, or `npm run test:librejs` will catch the omission.
