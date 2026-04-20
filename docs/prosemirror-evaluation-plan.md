# Plan: ProseMirror Editor Foundation Evaluation

## Goal

Evaluate whether **bare ProseMirror** should replace the current
CodeMirror-based Atom reader/editor as Atomic's long-term, production
editor foundation.

This is not a toy spike. The purpose is to answer a serious platform
question:

> Can ProseMirror support Atomic's markdown-first, Obsidian-like,
> single-surface editing experience with better long-term correctness,
> performance, and maintainability than the current CodeMirror
> architecture?

The evaluation must be strict enough that a "yes" result justifies a
multi-phase migration, and a "no" result is credible enough that we
keep investing in the current stack with clear eyes.

---

## Why Evaluate a Replacement

The current editor work in `src/components/atoms/AtomReader.tsx`,
`src/lib/codemirror-rich-markdown.ts`, and `src/lib/EDITOR.md`
demonstrates both:

1. A high-quality interaction target
2. An architectural mismatch

Atomic is trying to achieve a rendered, single-surface markdown
experience on top of a **code editor** whose core abstraction is a text
document with line-oriented viewport behavior.

That mismatch shows up in several ways:

- View mode and edit mode are separate layout engines
- Scroll preservation requires semantic matching heuristics and retry
  loops
- Selection/focus changes can mutate geometry
- Image handling relies on complex decoration behavior
- CodeMirror viewport assumptions break badly enough that we patched
  `@codemirror/view` to effectively disable virtualization

The current implementation is strong work. It is also evidence that we
may be spending engineering effort compensating for the editor
foundation rather than extending it.

---

## Decision Criteria

Bare ProseMirror should only be adopted if it credibly improves the
editor foundation along the dimensions that matter most to Atomic.

### Required

1. **Markdown remains the durable source of truth**
2. **Single mounted document surface**
3. **No renderer swap between read and edit**
4. **Stable block geometry during common interactions**
5. **Acceptable performance on representative large atoms**
6. **No engine patch equivalent to the current CodeMirror viewport
   patch**
7. **Extensible model for future block types and AI-assisted editing**
8. **Maintainable implementation boundaries**

### Nice to Have

1. Better image/media handling than the current editor
2. Better support for future block-level affordances
3. Cleaner command/state ownership than the current
   `reader-editor-bridge`
4. Easier regression testing around document structure and cursor
   behavior

---

## Non-Goals

This evaluation is **not** trying to:

- rebuild every current editor feature before making a decision
- preserve the exact current UI composition around the document surface
- prove every future editor capability up front
- reproduce every CodeMirror quirk or every Obsidian behavior
- migrate production code immediately

The evaluation exists to validate the editor core, not to front-load
the entire migration.

---

## Success Conditions

The evaluation succeeds if we can demonstrate all of the following on a
real vertical slice:

1. **Single-surface editing**
   One ProseMirror instance remains mounted while toggling between
   "reader-like" and "editor-like" interaction modes.

2. **Stable interaction model**
   Common operations like clicking into a heading, editing inside a
   list, focusing a code block, or interacting with an image block do
   not cause large scroll jumps or cursor misplacement.

3. **Faithful markdown round-tripping**
   Importing and exporting representative Atomic notes preserves
   structure well enough for real usage, including headings, lists,
   code fences, links, and images.

4. **Large-note viability**
   Representative large atoms remain responsive without a custom
   viewport patch or equivalent engine override.

5. **Architectural clarity**
   The implementation boundary between:
   - markdown parsing/serialization
   - ProseMirror schema/model
   - node views
   - read/edit interaction mode
   - Atomic persistence

   is materially clearer than the current combined reader/editor state
   machine.

---

## Failure Conditions

The evaluation should be considered a failure if any of these become
clear:

1. Markdown fidelity is not good enough without an unreasonable amount
   of custom serializer/parser work
2. Large note performance is still poor for the same fundamental
   reasons as the current editor
3. Image/media behavior still requires geometry-unstable hacks
4. The ProseMirror implementation surface is more complex than the
   current CodeMirror path without meaningful payoff
5. The resulting model drifts too far from Atomic's markdown-first
   product expectations

---

## Scope of the Evaluation Slice

The evaluation slice should be intentionally narrow but fully real.

### In Scope

- Markdown import
- Markdown export
- Headings
- Paragraphs
- Bold / italic / inline code
- Links
- Bullet lists
- Ordered lists
- Blockquotes
- Fenced code blocks
- Images
- Horizontal rules
- Single-surface read/edit interaction mode
- Performance instrumentation
- Scroll/cursor stability validation

### Explicitly Out of Scope for Phase 1

- Tags sidebar integration
- Related atoms sidebar
- Graph preview
- Full command palette integration
- Search/highlight parity with the current reader
- Every markdown extension Atomic might eventually support
- Mobile-specific optimization

These can be layered on later if the editor core proves sound.

---

## Proposed Architecture

### 1. Markdown Is Durable Storage

Atomic continues storing atom content as markdown text.

The editor runtime becomes:

```text
markdown string
  -> parse to ProseMirror document
  -> edit in ProseMirror
  -> serialize back to markdown
```

The editor's in-memory representation is semantic. Persistence remains
markdown.

### 2. One Mounted ProseMirror Surface

There is no "reader DOM" and "editor DOM" swap.

Instead:

- The ProseMirror surface remains mounted while the atom is open
- "Read mode" changes interaction affordances and styling
- "Edit mode" enables fuller editing affordances
- Mode changes should avoid major geometry changes

This is the core architectural bet. If mode changes mostly affect paint
and editor state rather than DOM structure, scroll/cursor stability
should be substantially easier to maintain.

### 3. Block-First Schema

The document should be modeled semantically using explicit nodes for:

- `doc`
- `paragraph`
- `heading`
- `blockquote`
- `ordered_list`
- `bullet_list`
- `list_item`
- `code_block`
- `image`
- `horizontal_rule`
- `text`

Marks should include:

- `strong`
- `em`
- `code`
- `link`

This matches the minimum viable set required for Atomic's existing
notes and gives us a solid baseline for future nodes like embeds,
callouts, citations, and custom blocks.

### 4. Geometry-Stable Node Views

Images and code blocks should be implemented as first-class nodes, not
text-line substitutions.

The rule for node views is strict:

> Interaction state must not substantially change the node's geometry.

That means:

- Images should retain stable reserved height
- Entering edit mode should not replace the image with radically
  different DOM
- Code blocks should remain block nodes in both modes
- Selection/focus should not collapse or expand surrounding layout in
  surprising ways

### 5. Read/Edit Mode as Editor State

Mode should be represented as editor/plugin state, not as separate
components with a global action bridge.

The current architecture leaks responsibilities across:

- `AtomReaderContent`
- `MainView`
- Zustand UI state
- `reader-editor-bridge.ts`

The ProseMirror path should aim for:

- document surface owns document commands
- surrounding UI calls into a typed controller/context
- mode is local to the document surface

### 6. Explicit Serialization Boundary

Markdown parse/serialize logic should be isolated from the view layer.

That allows:

- round-trip testing independent of UI
- schema changes without rewriting the React shell
- future migration of serializers if needed

---

## Open Technical Choice: Markdown Pipeline

There are two credible approaches:

### Option A: `prosemirror-markdown`

Pros:

- Official ProseMirror ecosystem package
- Direct alignment with ProseMirror schema model
- Lower moving-parts count

Cons:

- Less flexible than the unified/remark ecosystem for future markdown
  customization
- May require more custom work for Atomic-specific syntax over time

### Option B: `remark` / mdast -> ProseMirror mapping

Pros:

- Excellent markdown ecosystem
- Better long-term leverage if Atomic wants richer markdown
  transformations
- Easier to test and extend at the AST level

Cons:

- More work up front
- Requires an explicit mapping layer to and from ProseMirror

### Recommendation

Start with **`prosemirror-markdown`** for the first evaluation slice
unless it blocks required markdown fidelity early.

Reasoning:

- It keeps the evaluation focused on editor behavior rather than custom
  markdown infrastructure
- It gives us the shortest path to validating the ProseMirror document
  surface
- If the editor foundation proves sound, we can later decide whether
  the markdown pipeline should be upgraded to a remark-based mapping
  layer

---

## Evaluation Dataset

The editor foundation must be tested against real Atomic note shapes,
not synthetic markdown samples only.

The evaluation dataset should include:

1. Small note
   - headings
   - paragraphs
   - links
   - inline formatting

2. Medium note
   - nested lists
   - blockquotes
   - code fences

3. Image-heavy note
   - multiple images
   - mixed prose and image blocks

4. Large note
   - long imported article or clipped content
   - enough size to surface viewport/render cost issues

5. Round-trip stress note
   - a note containing representative markdown constructs likely to
     expose parse/serialize drift

---

## Acceptance Metrics

The evaluation should produce evidence, not just impressions.

### Correctness

- Markdown round-trip diff rate on representative corpus
- Cursor placement correctness in headings, lists, code blocks, and
  around images
- Undo/redo correctness for common editing operations

### Stability

- Scroll stability while moving between read/edit modes
- Scroll stability while interacting with image blocks
- Absence of large layout jumps during selection changes

### Performance

- Initial mount time for small, medium, and large notes
- Time-to-interactive after opening an atom
- Transaction latency for common edits
- Memory behavior on large notes

### Architecture

- Whether document commands can be owned by the ProseMirror surface
  directly
- Whether editor mode can be local instead of mirrored through global
  UI state
- Whether image/code/list behavior is simpler than the current
  CodeMirror implementation

---

## Implementation Phases

### Phase 0: Foundation Track Setup

- Create a dedicated ProseMirror editor workspace in `src/`
- Define evaluation schema and requirements in code
- Add dependency set required for the evaluation
- Keep the current CodeMirror reader/editor as the production path

### Phase 1: Core Document Surface

- Stand up a bare ProseMirror editor instance in React
- Define base schema
- Implement markdown import/export
- Render paragraphs, headings, lists, blockquotes, code blocks, links,
  and images

### Phase 2: Single-Surface Interaction Model

- Add read/edit mode as editor/plugin state
- Hide or soften editing chrome in read mode
- Validate that no renderer swap is required
- Ensure geometry remains stable while entering edit interactions

### Phase 3: Instrumentation and Regression Checks

- Add performance measurement hooks
- Add round-trip tests
- Add interaction checks for large notes and image blocks
- Compare behavior against current AtomReader pain points

### Phase 4: Decision

If the evaluation passes:

- Write migration plan from CodeMirror reader/editor to ProseMirror

If the evaluation fails:

- Document why
- Keep CodeMirror as incumbent
- Use findings to simplify the current architecture rather than fully
  replacing it

---

## Risks

### 1. Markdown Fidelity Cost

The hardest part may not be rendering. It may be preserving Atomic's
markdown expectations exactly enough that the editor feels trustworthy.

### 2. ProseMirror Complexity

Bare ProseMirror is powerful, but the implementation burden shifts onto
us. The evaluation has to verify that the complexity is buying us
better primitives, not just different problems.

### 3. Image and Media UX

Images are likely the critical stress case. If the ProseMirror node
view model does not materially simplify them, the case for migration
weakens.

### 4. React Integration Discipline

The evaluation should avoid mixing ProseMirror ownership with too much
React-driven DOM mutation. The editor surface must own the editable
document.

---

## Deliverables

The evaluation should produce:

1. A working ProseMirror vertical slice in the repo
2. Real notes used as evaluation fixtures
3. Round-trip and interaction verification
4. Measured comparison with the current editor on core concerns
5. A migration/no-migration recommendation grounded in evidence

---

## Recommended Immediate Next Steps

1. Add the ProseMirror dependency set and create an isolated editor
   workspace under `src/editor/prosemirror/`
2. Implement the base schema and markdown import/export path
3. Mount a minimal `AtomDocumentSurface` using a single ProseMirror
   instance
4. Validate one image-heavy and one large note before expanding scope

This keeps the work serious, incremental, and falsifiable.
