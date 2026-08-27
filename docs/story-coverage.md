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
| Snake   |   ✅    |   ✅   |   🔲   |      🔲       |
| Blast   |   ✅    |   ✅   |   🔲   |      🔲       |
| Gravity |   ✅    |   ✅   |   🔲   |      🔲       |
| Life    |   🔲    |   🔲   |   🔲   |      🔲       |

✅ exists · 🔲 desired, not yet built · — not applicable

## Behaviors to cover, beyond mode × interface

Real scenarios worth a story specifically because they've already caused a real bug once, not
just theoretical coverage gaps:

- 🔲 **Deliberate window resize / orientation change mid-session.** `tests/helpers/
  replay-driver.js` now replays mid-session `resize` events faithfully (not just the leading one)
  — no story has actually exercised this yet, since none of the three existing ones happen to
  contain a meaningful resize. Worth deliberately resizing/rotating while recording a future
  session specifically to get this covered.
- 🔲 **A narrow desktop viewport, no touch capability, that still triggers the mobile CSS
  layout.** Confirmed real, not hypothetical: `Render.isMobileViewport()` is purely width-based,
  so a low-res no-touch device (e.g. a small Chromebook) can land in the mobile layout despite
  having no touch at all. This exact scenario already caught a real bug (see "Open design
  questions" below) via a regular desktop.spec.js test, not a story — a story would additionally
  catch anything that only shows up across a full play *session* in this state, not just the one
  interaction that test checks.

## Open design questions

- **Should a narrow, no-touch desktop show the on-screen D-pad at all?** Confirmed live: the
  D-pad's buttons rendered but had no click handler bound on this exact device shape (narrow +
  no touch) — `js/main.js`'s `setupMobileControls` gated *binding* on touch capability while
  *visibility* was width-only. Fixed so the buttons that ARE shown actually work (binding no
  longer checks touch, since `.onclick` handles mouse clicks fine on its own). Still undecided:
  whether showing them there in the first place is the right call, or whether that's wasted
  screen space on a device that already has a keyboard — a genuinely different question from
  "do they work once shown," which is now settled.

Run `node scripts/check-story-coverage.js` to cross-check this table against the actual test
titles in `tests/stories*.spec.js` and flag any mismatch (a test that exists but isn't reflected
here, or a ✅ here with no matching test). It's a planning aid, not a CI gate — nothing here fails
a build.

Building a new one: capture a real session (the "report a bug" link's download/copy), then follow
`tests/stories.desktop.spec.js`'s file header for what makes a replay faithful, and
`tests/helpers/replay-driver.js` for the shared mechanism every story actually replays
through. Title it per the
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
  "Snake":   { "Desktop": "done",    "Mobile": "done",    "Tablet": "desired", "Safari": "desired" },
  "Blast":   { "Desktop": "done",    "Mobile": "done",    "Tablet": "desired", "Safari": "desired" },
  "Gravity": { "Desktop": "done",    "Mobile": "done",    "Tablet": "desired", "Safari": "desired" },
  "Life":    { "Desktop": "desired", "Mobile": "desired", "Tablet": "desired", "Safari": "desired" }
}
```
