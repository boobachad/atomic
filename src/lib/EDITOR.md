# Atom viewer & editor

Guide for future development. Read this before touching
`AtomReader.tsx`, `codemirror-rich-markdown.ts`, or
`codemirror-config.ts`. The seemingly simple "render markdown, let the
user edit it" contract hides a thicket of layout race conditions —
most of the non-obvious code here exists because we learned something
the hard way.

---

## Mental model

An **atom** is rendered in one of two modes:

- **View mode**: react-markdown renders an `<article>` with prose
  styling. Images go through `MarkdownImage` which wraps an `<img>` in
  a `.markdown-image-wrapper` span.

- **Edit mode**: CodeMirror 6 renders the raw markdown text with
  Obsidian-style live-preview decorations. Headings, links, emphasis,
  and images *look* like their view-mode counterparts; click into a
  line and the markdown "unfolds" on that line only.

Mode is toggled by the pencil button in the titlebar. Both modes share
the same scroll container; the toggle tries to preserve the content
position (see `AtomReaderContent.capturePosition` /
`restoreByPosition`).

Rendering for view mode lives in `src/components/atoms/AtomReader.tsx`
(the `MemoizedMarkdownChunk` + `markdownComponents`). Rendering for
edit mode lives in
[`codemirror-rich-markdown.ts`](./codemirror-rich-markdown.ts) (the
decorations) and
[`codemirror-config.ts`](./codemirror-config.ts) (the theme +
extension composition).

---

## The `VP.Margin` patch

`patches/@codemirror+view+6.38.8.patch` bumps CM6's `VP.Margin`
constant from `1000` → `10_000_000`. This effectively disables
CodeMirror's viewport virtualisation: the whole document is rendered
and measured up front.

**Why**: CM6's heightmap assumes mostly-uniform line heights with
small variance, using lazily-measured "estimated" heights for off-
viewport lines. Our decorations produce ~20× variance in line height
(H1 = 40px, paragraph = 28px, image widget = 400px+, blank = 0px), so
CM's heightmap drifts every time a new line scrolls into view —
visibly re-flowing the content under the user's cursor and breaking
click-to-position mapping.

The patch is ugly but stable. Alternative approaches (better
estimates, a separate height-measurement pass, forking CM's viewport
code) were considered and rejected — see the "virtualisation" section
in `CLAUDE.md` for the rationale.

**Cost**: mount time scales linearly with document size. ~22ms for a
14KB atom, ~150ms for a 450KB Wikipedia atom. Beyond roughly 5000
lines this becomes noticeable; the next escalation would be
segment-based rendering (several small CM instances stitched together,
à la Notion).

**Version lock-in**. The patch file name (`@codemirror+view+6.38.8.patch`)
is tied to an exact version. `@codemirror/view` is a transitive dep
pulled in via `@codemirror/lang-markdown` and `@uiw/react-codemirror`,
so normal semver resolution would happily pick up a minor bump that
invalidates the patch's line-number context. Two safeguards in
`package.json`:

- `overrides: { "@codemirror/view": "6.38.8" }` forces the resolver
  to pin the exact version regardless of transitive ranges.
- `postinstall` runs `patch-package --error-on-fail` so an install
  that can't apply the patch halts loudly instead of silently leaving
  virtualisation enabled (which would bring back every heightmap
  drift bug documented in this file).

When you intentionally upgrade CM: `npm install @codemirror/view@X.Y.Z`,
update `overrides`, regenerate the patch (`npx patch-package @codemirror/view`),
and rename the file.

---

## Decorations: two layers

Live-preview decorations come from two places:

### `richMarkdownPlugin` (ViewPlugin)

Handles everything that can be expressed as `Decoration.mark` (hide
ranges), `Decoration.line` (style a line), or inline
`Decoration.replace` (swap a range for a widget). Rebuilt on
`docChanged`, `viewportChanged`, and `selectionSet`.

Covers: heading classes (`cm-md-h1`..`h6`), paragraph margins (`cm-md-
p-start`/`-end`), list item decorations, blank-line collapsing, mark
hiding (`##`, `**`, `` ` ``, `[`, `](...)` — hidden on non-active
lines), escape-backslash hiding, and mid-paragraph inline images (rare
but handled).

### `imageField` (StateField)

Whole-line images only (the common case: bare `![alt](url)` or
Wikipedia-style `[![alt](url)](link)` on their own line). Needs a
StateField because it emits **block** decorations, which `ViewPlugin`
can't do.

Behaviour by active state:
- **Inactive line**: `Decoration.replace` over `[line.from, line.to]`
  with the image widget → the entire line is replaced by the rendered
  image.
- **Active line** (caret on it): `Decoration.widget({block:true,
  side:1})` at `line.to` → line's raw markdown stays visible, image
  appears as a block widget below it.

The matching regexes live at the top of the file as `BARE_IMG_LINE` /
`LINKED_IMG_LINE`. Note: URLs can contain escaped parens
(`...\(cropped\).jpg` — web clippers love these), so `URL_CHARS` is
`(?:\\.|[^)\s])+`, not `[^)\s]+`.

---

## The image click saga

This is where most of the pain lives. Clicking an image widget should
place the caret on the image's source line, which flips `imageField`'s
rendering so the raw markdown becomes editable. Sounds simple. Isn't.

The fundamental problem: the decoration swap changes the layout
mid-gesture. The IMG element under the user's pointer gets detached
and re-attached somewhere else. Every naive approach races with
CodeMirror's mouse pipeline:

| Approach | Fails because |
|---|---|
| `domEventHandlers.mousedown` + `view.dispatch` + `return false` | CM's own mousedown runs afterwards, re-queries `posAtCoords` against the rebuilt layout, dispatches a different selection (usually the blank or paragraph *above* the image). That second dispatch wins. |
| `domEventHandlers.mousedown` + dispatch + `preventDefault + return true` | `runHandlers` loop breaks, CM's mousedown doesn't run. Image click works. **But**: the decoration swap leaves CM's heightmap out-of-sync with the DOM. Any subsequent click on a different line (e.g. a heading above) calls `posAtCoords` against the stale heightmap and lands on the wrong position. |
| `domEventHandlers.click` | Browser skips the `click` event because the mousedown target (the IMG) is detached before mouseup. |
| `domEventHandlers.mouseup` | Mouseup fires on an element outside `cm-content` for the same reason, so `domEventHandlers` doesn't dispatch it. |
| `EditorView.mouseSelectionStyle` + return a custom style | Image click works, but — this is the truly weird one — any non-null return from this facet, even a clone of `basicMouseSelection`, leaves CM's `inputState.mouseSelection` in a state where the *next* mousedown elsewhere can't move the cursor. No idea why. |

### Current solution (two parts)

1. **Image click**: `domEventHandlers.mousedown` + synchronous
   `view.dispatch` + `preventDefault` + `return true` (the "second
   row" from the table). Wins the mousedown race.

2. **Post-image-click fallback**: immediately after the dispatch, arm
   a one-shot `mousedown` capture listener on `cm-content` (see
   `armNextClickDomResolver`). For the *very next click only*, it:
   - Resolves the target element via
     `document.elementFromPoint` (live DOM).
   - Walks up to the owning `cm-line`.
   - Uses `document.caretRangeFromPoint` + CM's internal
     `posFromDOM` to get the exact caret position at the click x/y —
     **not** `posAtCoords`, which would consult the stale heightmap.
   - Dispatches that selection and calls `preventDefault +
     stopImmediatePropagation` on the event so CM's own mousedown
     doesn't run and re-dispatch via the stale heightmap.
   - Disarms.

   The listener disarms itself on the first handled click. No
   timeout; earlier versions had a 500ms timeout and users easily
   took longer than that between clicks.

### Why `posAtCoords` goes stale

CM's heightmap stores line positions; the decoration swap changes
line 31's height (from ~419px inline-replace to 28px raw-markdown +
419px block-widget). The DOM updates synchronously during our
dispatch, but CM's heightmap re-measure runs on a `requestAnimation
Frame` cycle. Until that fires, `posAtCoords(x, y)` for y-values near
the image line returns positions from the old heightmap. No amount of
`view.measure()` / `observer.forceFlush()` reliably forces it
synchronous in one hop.

### Regex landmines

- `BARE_IMG_LINE` and `LINKED_IMG_LINE` must match on the **full
  line text**, not the parsed AST node, because for linked images the
  `Image` node covers only `![alt](url)` while the line is
  `[![alt](url)](link)`.
- `URL_CHARS = (?:\\.|[^)\s])+` handles escaped parens — without
  this, Wikipedia images with `\(cropped\)` in the URL stop matching
  and the image disappears on click.
- The whole-line check in the ViewPlugin's inline Image handler
  references these same regexes to avoid emitting a competing inline
  replace over a range `imageField` is already handling.

---

## `activeLines`: caret only, not range

`activeLines(view)` returns the set of lines where hidden markdown
(heading `##`, link syntax, escapes) should unfold. It **only**
includes lines with an empty (caret) selection range:

```ts
for (const range of view.state.selection.ranges) {
  if (!range.empty) continue;
  set.add(view.state.doc.lineAt(range.from).number);
}
```

Why not include lines spanned by a range selection? Because that
would trip the blank-line collapse. `.cm-md-blank` zeros the line's
height; drag-selecting across a paragraph that contains a blank line
would un-collapse the blank (CM re-renders the decorations on
selection change), the line would grow from 0 → 28px, and everything
below would jump down by a line-height *per blank in the selection*.
Users saw it as "selection is adding padding between blocks" —
measured via `scripts/harness/check-selection-gaps.mjs`, up to 220px
of drift.

Guard: `check-selection-gaps.mjs` verifies line positions stay stable
during a range selection.

---

## Margin-matching with prose

View mode uses Tailwind Typography (`.prose`); edit mode uses our own
`cm-md-*` classes. The goal is for a paragraph in edit mode to land
at the same y-coordinate as its view-mode rendering, so view↔edit
toggle doesn't shift content.

Key constraints we learned:

- Paragraph `line-height` in CM is inherited from the parent
  `.prose` (1.75), matching view. Don't override it.
- `cm-md-p-start { margin-top: 1.25em }` + `cm-md-p-end {
  margin-bottom: 1.25em }` collapse between consecutive paragraphs
  to 1.25em — same as `.prose p`.
- Image-paragraph margins (`cm-md-imgp-start/end`) were originally
  `2em` each side — *double* the effective view-mode gap, which
  accumulated into ~128px of drift across 8 images. They're `1.25em`
  now to match the collapsed `<p>` + wrapper gap view produces. See
  `measure-margins.mjs` for the calibration and
  `diagnose-premount-drift.mjs` for the accumulation test.
- Blank lines collapse via `.cm-md-blank { height: 0; line-height: 0
  }` + `.cm-md-blank > br { display: none }`. The `<br>` removal is
  load-bearing: without it, the empty block doesn't qualify for
  margin-collapse per the CSS spec, and paragraph gaps end up
  double-counted. Do not add padding or border to `.cm-md-blank`
  unless you want to re-run that bug.

Residual drift on the kdenlive atom (~14KB, 8 images) is ~28px over
the whole doc — small enough that the view↔edit scroll-position-
preserve logic anchors around it.

---

## Click-collapse handler

`clickCollapseHandler` fixes an Obsidian-style bug: clicking inside a
paragraph that contains a hidden link, the mousedown lands at doc-pos
A (computed against the *collapsed* visible text). CM flips the line
to active, the hidden `[...](...)` syntax reveals, text shifts, and
mouseup on the same screen coord lands at doc-pos B. CM treats A..B
as a drag-selection and highlights a chunk the user didn't mean to
select.

Fix: on `mouseup`, if the pointer moved ≤4px between mousedown and
mouseup AND CM produced a range selection (`sel.from !== sel.to`),
collapse it to the head. Genuine drag-selects (moved > 4px) are
untouched. Modifier keys (shift/meta/ctrl/alt) skip the collapse
entirely so range-extend and multi-cursor gestures work.

---

## Selection styling & search panel

Two gotchas with CM's base theme:

### Selection background

CM ships
`&light.cm-focused > .cm-scroller > .cm-selectionLayer
.cm-selectionBackground { background: #d7d4f0 }` — a 5-combinator
selector that out-specifics any plain `.cm-selectionBackground`
override in our theme. Our accent purple would only land while the
editor was *unfocused*; the moment it refocused, CM's pastel lavender
won.

Fix: match CM's selector depth in `src/index.css` (not in the
`EditorView.theme` object, where our rules can't reach that
specificity).

### Search panel

Same story for `.cm-panels`. CM's `&light .cm-panels` default would
drop a light-grey panel over our dark surface. Fix: `.cm-editor.cm-
light .cm-panels, .cm-editor.cm-dark .cm-panels` rules in
`src/index.css` driven by design-system CSS variables — the panel
tracks the reader theme automatically.

---

## Pre-mounting edit mode (don't)

Twice we've tried to mount CM in the background while the user is in
view mode, so clicking Edit feels instant. Both attempts regressed
the harness significantly. Root cause: CM rendered while hidden has
per-line height differences from when it's visible (image widgets
measure against the wrong container width, image-size cache
populates in the wrong order, etc).

We tried:
- `visibility: hidden` + `position: absolute` (CM laid out under
  hidden styling): 6/10 harness, +192px toggle drift.
- `display: none` (not laid out): 5/10 harness, catastrophic
  ~8500px scroll-stability drift — CM's heightmap never initialises
  without layout.

Leave this alone until you have a concrete plan to synchronise CM's
layout with the visible article, line-by-line. The 22–150ms mount
cost on click is a reasonable tradeoff for correctness.

Diagnostic: `scripts/harness/measure-edit-mount.mjs`.

---

## View↔edit scroll preservation

`AtomReaderContent.capturePosition` captures the topmost visible
block at toggle time — either by image src (for image blocks) or by a
normalised text prefix (first 60 chars, escapes stripped, link syntax
stripped, list markers stripped). `restoreByPosition` finds the same
block in the new mode and adjusts `scrollTop` so it lands at the
captured y-offset.

Caveats:
- The text normaliser strips `[\\*_`#~]` so escape sequences (`25\.
  04\.0`) match the rendered text (`25.04.0`). Before this was
  added, ~120px of toggle drift was caused by matching the wrong
  cm-line.
- List-item captures needed `^(?:[-*+]|\d+\.)\s+` stripping too —
  source lines start with `- ` but view's `<li>` text doesn't.
- `findTargetElement` in view walks specific block tags (`h1-6, p,
  li, blockquote, pre, figure`), not `article.children`, so it
  doesn't accidentally snap to the wrapping `<ul>` for list items.

---

## Harness

`scripts/harness/` is the test suite. It drives a real Chromium via
Playwright against the dev server. Requires
`ATOMIC_AUTH_TOKEN` and, for non-default databases, `DATABASE_ID`.

Main entry: `npm run editor-harness` — runs ten scenarios covering
scroll stability, click accuracy, toggle roundtrip, image-cutoff
preservation, rapid-toggle stability, image-click reveal, heading-
mark fade, height parity, scroll-no-shift, and boundary clicks.
Baseline is 8/10 passing on the kdenlive state-of-the-year atom; the
two failures are a 4px click-edge miss and a ~28px toggle drift on
one landmark.

Specialised diagnostics:

| Script | Checks |
|---|---|
| `check-image-stays.mjs` | Clicking an image keeps it visible (as a block widget below the revealed markdown), not replaces it. |
| `check-heading-click-after-image.mjs` | The heightmap-staleness workaround — click image, then heading, cursor moves. |
| `check-heading-click-direct.mjs` | Baseline: click heading without prior image click. Should always pass. |
| `check-heading-click-after-paragraph.mjs` | Baseline: confirms the issue is image-click-specific, not click-chaining in general. |
| `check-selection-gaps.mjs` | No layout shift during range selection. |
| `diagnose-premount-drift.mjs` | Per-landmark view↔edit position diff; run after changing CSS margins. |
| `measure-margins.mjs` | Dumps image surround gaps (prev/next) in view vs edit. |
| `measure-paragraphs.mjs` | Dumps paragraph heights + margins in both modes. |
| `measure-edit-mount.mjs` | Click-to-edit mount time across atom sizes. |
| `debug-image-pos.mjs` | Shows `posAtCoords` vs `elementFromPoint` drift — the heightmap staleness smoking gun. |

These are kept in the repo even though they're mostly for
debugging: they're small, self-contained, and each one was written
in response to a specific bug. Running them takes seconds and each
gives a clear pass/fail on a specific invariant. Please add new ones
for new classes of bug rather than accumulating test cases into
`run.mjs`.

---

## Known limitations

- **Residual toggle drift**: ~28px worst case on the kdenlive atom.
  Comes from accumulated small per-element height differences between
  view's prose and edit's `cm-md-*` rules. Fixable with more careful
  CSS, but further alignment is whack-a-mole territory.
- **Mount time on 450KB+ atoms**: ~150ms. See pre-mount section.
- **Heading click mid-heightmap-update**: there's a ~single-frame
  window after an image click where a click on another line could
  still land on the wrong position. Hard to hit in real use because
  the one-shot listener covers the usual case, and a second click
  within 16ms is rare.

---

## Files index

| File | Role |
|---|---|
| `codemirror-config.ts` | EditorView theme, syntax highlighting, extension composition (`getEditorExtensions`). |
| `codemirror-rich-markdown.ts` | Live-preview decorations (`richMarkdownPlugin` + `imageField`), image click handler, click-collapse handler, blank/paragraph/heading styling logic. |
| `image-size-cache.ts` | Shared src→{naturalWidth, naturalHeight, renderedHeight} map. View mode populates it; edit mode's ImageWidget reads from it for accurate `estimatedHeight`. |
| `../components/ui/MarkdownImage.tsx` | View-mode image component. Writes to image-size-cache on load. |
| `../components/atoms/AtomReader.tsx` | Top-level viewer + editor wrapper. Owns scroll preservation, view↔edit toggle, edit-mode state machine. |
| `../../patches/@codemirror+view+6.38.8.patch` | The `VP.Margin` virtualisation disable. |
| `../../scripts/harness/` | Playwright-based regression harness. |

If you change anything in here, run `npm run editor-harness` before
committing. If you can reproduce a bug, write a new `check-*.mjs` for
it first — we've already paid the price for skipping that step more
than once.
