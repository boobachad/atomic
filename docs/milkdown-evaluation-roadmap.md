# Milkdown Evaluation Roadmap

## Goal

Turn the `?pm-eval=1` route from a bare editor smoke test into a serious
feature track that answers one question:

Can Milkdown become a production-worthy Atomic editor foundation without
drifting into clunky toolbar-first rich text behavior?

The evaluation should stay narrow and sequential. We add one feature,
judge it directly in the eval surface, then decide whether the next
feature strengthens or weakens the case for Milkdown.

## Principles

- Keyboard-first over toolbar-first.
- Prefer data-dense UI over roomy demo chrome.
- Markdown remains a first-class persistence format.
- Prefer structural commands and text shortcuts over floating formatting UI.
- Avoid source-near hacks that destabilize layout.
- Add features in vertical slices that are usable immediately.
- Keep the eval route honest: if a capability is not really there, do not
  fake it.

## Phases

### Phase 1: Directness

Prove that the editor can feel modern and low-friction before it is
feature-complete.

1. Slash command menu for structural block transforms.
2. Command execution helpers for paragraph, headings, lists, quote, code,
   and divider.
3. Cleaner active-state visuals around the current block and slash menu.
4. Basic keyboard polish for slash interaction:
   arrow navigation, enter to apply, escape to dismiss.

Acceptance:

- Creating structure feels command-driven, not toolbar-driven.
- Command surfaces stay compact and information-dense.
- The slash menu does not cause visible layout instability.
- The editor still feels coherent on both the fixture and real atoms.

### Phase 2: Markdown Trust

Prove that Milkdown can be trusted as a markdown-backed editor rather than
just a nice rich text surface.

1. Add round-trip instrumentation for initial markdown vs current markdown.
2. Flag obvious markdown drift in the eval side panel.
3. Build a small corpus of representative real-note fixtures.
4. Validate headings, lists, quotes, fences, links, tables, and task lists
   against those fixtures.

Acceptance:

- Markdown output is stable enough to trust on real Atomic notes.
- Drift is visible, attributable, and not hidden by the eval shell.

### Phase 3: Atomic Core Blocks

Prove that Milkdown can handle the blocks Atomic actually cares about.

1. Image block behavior evaluation.
2. Link handling and editing flow.
3. Task lists and GFM table behavior review.
4. Code block ergonomics review.

Acceptance:

- Image, code, and list-heavy notes feel credible, not fragile.
- The markdown model still looks trustworthy after editing these blocks.

### Phase 4: Atomic Interaction Layer

Start testing whether Milkdown can host Atomic-specific editing behaviors.

1. Atom-aware slash commands.
   Examples: insert link to atom, create related atom stub, insert citation.
2. Save lifecycle integration with draft state instead of the standalone
   eval-only loop.
3. Selection/focus behavior review inside the real drawer layout.

Acceptance:

- Atomic-specific behaviors layer in without obvious state-model fights.
- The integration story is cleaner than the current `AtomReader` split.

## Sequence

The next features should be implemented in this order:

1. Slash command menu.
2. Markdown round-trip drift panel.
3. Image block evaluation.
4. Task list and table review.
5. Atom-aware slash actions.

## Non-goals For This Track

- Reproducing Obsidian-style literal syntax editing.
- Rebuilding every existing `AtomReader` behavior before deciding.
- Shipping Milkdown into production before the markdown and block-model
  risks are better understood.

## Exit Criteria

Milkdown is worth deeper investment only if:

- the keyboard-first interaction model feels fresh enough,
- markdown output remains trustworthy on real notes,
- the important block types do not feel brittle,
- and Atomic-specific behaviors can be layered on without repeating the
  selection/layout problems already seen in other approaches.
