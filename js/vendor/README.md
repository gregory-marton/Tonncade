# Vendored third-party code

Tonncade is otherwise entirely hand-rolled, zero external JS dependencies. VexFlow is the one
deliberate exception (see `docs/melody-notation-design.md`): notation engraving is a genuinely
hard, well-solved problem, not one worth reinventing.

## vexflow.js

Source: the `vexflow` npm package (`build/cjs/vexflow.js`), verbatim except for a wrapper comment
adding a LibreJS-recognized `@license`/`@license-end` block (`docs/librejs-compliance.md` --
LibreJS scans the SERVED file for a machine-readable license comment, not npm metadata or a
LICENSE file sitting next to it). MIT/Expat licensed, zero dependencies of its own. Full upstream
license text: `vexflow.LICENSE`.

To update: `npm pack vexflow`, extract, take `build/cjs/vexflow.js`, re-wrap with the same
`@license magnet:?xt=urn:btih:d3d9a9a6595521f9666a5e94cc830dab83b65699&dn=expat.txt Expat` /
`@license-end` markers (the magnet URI is LibreJS's own recognized identifier for the Expat/MIT
license -- verified directly against a sibling `librejs` checkout's
`common/license_definitions.json`, not from memory). Re-run `npm run test:librejs` after updating.

**Not yet verified**: `npm run test:librejs` was actually attempted against the sibling
`../librejs` checkout -- Firefox and geckodriver ARE present here, but the run failed with
`UnsupportedOperationError: Navigation to "about:debugging#/runtime/this-firefox" is not allowed
in this context`, a sandboxing restriction on the test harness's own Firefox-internal-page
navigation, unrelated to this file. Needs re-running in an environment without that restriction
before this vendoring is considered fully LibreJS-verified.
