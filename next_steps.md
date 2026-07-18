# Next Steps: Future Feature Ideas

New-capability ideas that aren't blocking the mobile experience itself — as opposed to
`mobile_redesign_plan.md`'s backlog, which is scoped to what's needed for a good, consistent
mobile experience. Numbered to match the task tracker. None of this has been designed or
planned yet.

- **#24 Sandbox mode tap-and-hold note highlighting**: tap-and-hold a cell to highlight every other cell with the same note name across the lattice, with each highlighted cell's octave-qualified note name (e.g. "C3") and frequency (e.g. "440Hz") overlaid.
- **#27 Melody mode MIDI source, post-playback transform, bundled songs**:
  - Replace the raw upload picker with a local MIDI folder the player sets once, browsed via a dropdown of its contents — no search/download feature.
  - After playing the melody, its notes stay highlighted and become a moveable shape as a whole — draggable to translate/transpose, two-finger rotate for harmonic variation — with a new control to save the altered MIDI afterward.
  - Ship a dozen or so public-domain children's songs alongside "Hot Cross Buns." Open question, explicitly for later exploration/conversation, not yet decided: bundle them as part of the app's files, or serve them from a web directory that could double as a shareable alternative to a local MIDI folder — writable web directories may not be a realistic option, so this needs more thought before designing.
- **#28 Device-rotation as a viewing angle, not just a resize** (farther future): in Gravity mode, rotating the device correctly keeps "higher pitch = up" fixed on screen, since falling pieces need a stable notion of "down" — that stays as is. In Blast, Snake, Melody, and Sandbox, none of which have gravity-driven mechanics, device rotation could instead let the Tonnetz visually rotate along with the phone (0°/90°/180°/270°), so physically turning the device reveals a different rotated view of the same fixed lattice, while controls/stats and — critically — each hex's in-grid note-name label counter-rotate individually to stay upright and legible regardless of the overall grid's rotation. Needs a real device-orientation-angle read (`screen.orientation.angle` or equivalent) with early cross-browser verification, since this API has had inconsistent behavior on iOS Safari historically.
