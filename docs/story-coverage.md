# Story test coverage

Tracks which real-session story tests (`tests/stories*.spec.js`, see that file's own header for
what makes a story test different from an ordinary interaction test — a real captured session,
never a hand-written move sequence) exist per mode × interface, and which are still desired.

## Matrix

| Mode    | Desktop | Mobile | Tablet | Safari (iOS) |
|---------|:-------:|:------:|:------:|:-------------:|
| Sandbox |   🔲    |   🔲   |   🔲   |      🔲       |
| Melody  |   🔲    |   🔲   |   🔲   |      🔲       |
| Compose |   🔲    |   🔲   |   🔲   |      🔲       |
| Snake   |   ✅    |   🔲   |   🔲   |      🔲       |
| Blast   |   ✅    |   🔲   |   🔲   |      🔲       |
| Gravity |   ✅    |   🔲   |   🔲   |      🔲       |
| Life    |   🔲    |   🔲   |   🔲   |      🔲       |

✅ exists · 🔲 desired, not yet built · — not applicable

Run `node scripts/check-story-coverage.js` to cross-check this table against the actual test
titles in `tests/stories*.spec.js` and flag any mismatch (a test that exists but isn't reflected
here, or a ✅ here with no matching test). It's a planning aid, not a CI gate — nothing here fails
a build.

Building a new one: capture a real session (the "report a bug" link's download/copy), then follow
`tests/stories.spec.js`'s file header for what makes a replay faithful, and
`tests/helpers/replay-driver.js` for the shared mechanism every story (and
`scripts/replay-live.js`'s headed CLI viewer) actually replays through. Title it per the
convention in that same file header, then flip its cell above from 🔲 to ✅ and add it to the
JSON block below.

## Desired matrix (machine-readable)

The block below is what `scripts/check-story-coverage.js` actually reads — keep it in sync with
the table above by hand; the check script doesn't parse the markdown table itself, since a
hand-formatted table is too fragile to regex reliably. Each value is one of `"done"`,
`"desired"`, `"n/a"`.

```json
{
  "Sandbox": { "Desktop": "desired", "Mobile": "desired", "Tablet": "desired", "Safari": "desired" },
  "Melody":  { "Desktop": "desired", "Mobile": "desired", "Tablet": "desired", "Safari": "desired" },
  "Compose": { "Desktop": "desired", "Mobile": "desired", "Tablet": "desired", "Safari": "desired" },
  "Snake":   { "Desktop": "done",    "Mobile": "desired", "Tablet": "desired", "Safari": "desired" },
  "Blast":   { "Desktop": "done",    "Mobile": "desired", "Tablet": "desired", "Safari": "desired" },
  "Gravity": { "Desktop": "done",    "Mobile": "desired", "Tablet": "desired", "Safari": "desired" },
  "Life":    { "Desktop": "desired", "Mobile": "desired", "Tablet": "desired", "Safari": "desired" }
}
```
