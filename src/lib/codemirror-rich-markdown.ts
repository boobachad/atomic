import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import {
  estimateDisplayedHeight,
  recordImageSize,
  recordRenderedHeight,
} from './image-size-cache';

/**
 * Obsidian-style live preview for the markdown editor.
 *
 * This extension RELIES on `@codemirror/view` being patched via
 * `patches/@codemirror+view+*.patch` so that `VP.Margin` is enormous and CM's
 * viewport effectively covers the entire document. Without that patch,
 * per-line heights that differ from CM's default estimate (heading sizes,
 * paragraph margins, image widgets) cause heightmap drift as new lines
 * scroll into view, breaking scroll stability and click-to-line mapping.
 *
 * With the patch, all lines are rendered and measured up front. Decorations
 * can freely change line heights without causing drift.
 *
 * - Heading lines get `cm-md-h1`..`cm-md-h6` classes sized to match prose.
 * - Inline syntax marks (`#`, `*`, `**`, `` ` ``, link brackets + URL) hide
 *   when the cursor isn't on that line.
 * - Blank source-lines (between paragraphs) collapse to zero height outside
 *   code blocks; margin-collapse-friendly so heading/paragraph spacing
 *   matches prose.
 * - Paragraph lines get top/bottom margin classes that collapse to prose's
 *   1.25em gap.
 * - List items get their own indentation and spacing classes.
 * - Image markdown on its own line is replaced with an `<img>` widget; when
 *   the cursor lands on that line the widget unwraps to the raw markdown.
 */

// --- Line decorations -------------------------------------------------------

const HEADING_LINE_CLASS: Record<string, string> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  SetextHeading1: 'cm-md-h1',
  SetextHeading2: 'cm-md-h2',
};

const headingLineDeco: Record<string, Decoration> = Object.fromEntries(
  Object.entries(HEADING_LINE_CLASS).map(([name, cls]) => [
    name,
    Decoration.line({ class: cls }),
  ])
);

const hideMark = Decoration.mark({ class: 'cm-md-hidden' });
const blankLineDeco = Decoration.line({ class: 'cm-md-blank' });
const paragraphStartDeco = Decoration.line({ class: 'cm-md-p-start' });
const paragraphEndDeco = Decoration.line({ class: 'cm-md-p-end' });
const imageParagraphStartDeco = Decoration.line({ class: 'cm-md-imgp-start' });
const imageParagraphEndDeco = Decoration.line({ class: 'cm-md-imgp-end' });
const listItemLineDeco = Decoration.line({ class: 'cm-md-li' });
const listStartLineDeco = Decoration.line({ class: 'cm-md-list-start' });
const listEndLineDeco = Decoration.line({ class: 'cm-md-list-end' });
const nestedListStartDeco = Decoration.line({ class: 'cm-md-list-start-nested' });
const nestedListEndDeco = Decoration.line({ class: 'cm-md-list-end-nested' });

// --- Image widget -----------------------------------------------------------

const IMG_ESTIMATED_HEIGHT = 320;
const ASSUMED_CONTAINER_WIDTH = 720;

class ImageWidget extends WidgetType {
  constructor(readonly alt: string, readonly src: string) {
    super();
    if (!estimateDisplayedHeight(src, ASSUMED_CONTAINER_WIDTH)) {
      const probe = new Image();
      probe.src = src;
      if (probe.complete && probe.naturalWidth > 0) {
        recordImageSize(src, probe.naturalWidth, probe.naturalHeight);
      }
    }
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  get estimatedHeight() {
    return (
      estimateDisplayedHeight(this.src, ASSUMED_CONTAINER_WIDTH) ??
      IMG_ESTIMATED_HEIGHT
    );
  }
  toDOM(view: EditorView) {
    const img = document.createElement('img');
    img.decoding = 'async';
    img.className = 'cm-md-img';
    const src = this.src;
    const remeasure = () => {
      if (img.naturalWidth > 0) {
        recordImageSize(src, img.naturalWidth, img.naturalHeight);
      }
      const rect = img.getBoundingClientRect();
      if (rect.height > 0) recordRenderedHeight(src, rect.height);
      view.requestMeasure();
    };
    img.addEventListener('load', remeasure, { once: true });
    img.addEventListener('error', remeasure, { once: true });
    img.src = src;
    if (this.alt) img.alt = this.alt;
    if (img.complete) requestAnimationFrame(remeasure);
    requestAnimationFrame(remeasure);
    return img;
  }
  ignoreEvent(event: Event) {
    return event.type !== 'mousedown';
  }
}

// Whole-line image patterns we treat as "the line is effectively an image":
//   bare:   `![alt](url)` or `![alt](url "title")`
//   linked: `[![alt](url)](link)` — image wrapped in a link (web clippers
//           emit this constantly, e.g. every Wikipedia figure).
// Both should show as a rendered image when inactive, and as raw-markdown-
// above-image-block when the cursor lands on the line.
//
// URLs may contain escaped parens (`\(`, `\)`), e.g. Wikipedia URLs like
// `File:ENIAC-changing_a_tube_\(cropped\).jpg`. `URL_CHARS` matches either
// a backslash-escape of any char or any non-paren/whitespace char.
const URL_CHARS = String.raw`(?:\\.|[^)\s])+`;
const BARE_IMG_LINE = new RegExp(
  String.raw`^!\[([^\]]*)\]\((${URL_CHARS})(?:\s+"[^"]*")?\)$`,
);
const LINKED_IMG_LINE = new RegExp(
  String.raw`^\[!\[([^\]]*)\]\((${URL_CHARS})(?:\s+"[^"]*")?\)\]\(${URL_CHARS}(?:\s+"[^"]*")?\)$`,
);

// --- Decoration construction ------------------------------------------------

// Lines that should render in their "active" (unhidden) form. A line is
// active when a *caret* (collapsed selection) is on it — that's when we
// want to reveal hidden markdown, expand blank lines so the caret is
// visible, etc. Lines merely *traversed* by a range selection are NOT
// active: expanding a blank line mid-range would push everything below it
// down by a line-height while the user drags, giving the impression that
// selection adds padding between blocks.
function activeLines(view: EditorView): Set<number> {
  const set = new Set<number>();
  for (const range of view.state.selection.ranges) {
    if (!range.empty) continue;
    set.add(view.state.doc.lineAt(range.from).number);
  }
  return set;
}

function isInsideCodeBlock(view: EditorView, pos: number): boolean {
  const tree = syntaxTree(view.state);
  let n = tree.resolveInner(pos, 1);
  for (let cur: typeof n | null = n; cur; cur = cur.parent) {
    if (cur.name === 'FencedCode' || cur.name === 'CodeBlock') return true;
  }
  return false;
}

// Markdown block nodes (ListItem, BulletList, Paragraph, etc.) often
// carry a `to` that sits at the START of the next line — i.e. just past
// the trailing newline. Naively calling `doc.lineAt(node.to).number`
// then returns a line that is NOT actually part of the node, and
// decoration ranges leak onto it (e.g. after exiting a list the next
// paragraph picks up `cm-md-li`). Walk back one char so `lineAt`
// always resolves to the last line that really contains node content.
function lastLineOf(doc: { line(n: number): { from: number }; lineAt(pos: number): { number: number } }, node: { from: number; to: number }): number {
  const end = Math.max(node.from, node.to - 1);
  return doc.lineAt(end).number;
}

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const cursorLines = activeLines(view);
  const doc = view.state.doc;
  const docEnd = doc.length;

  // Blank lines collapse to zero height for CSS margin-collapse to work
  // between adjacent paragraphs, but we deliberately only collapse the
  // LAST blank in any run. Earlier blanks in the run stay full-height so
  // the user can type `Enter` multiple times to add real vertical space
  // — otherwise two blanks look identical to one (since the blank lines
  // are invisible and the surrounding paragraph margins just collapse).
  //
  // Rule: a blank line gets `cm-md-blank` only if the next line exists
  // and is NOT also blank. Cursor-active blanks and blanks inside code
  // fences are left alone too.
  let pos = 0;
  while (pos <= docEnd) {
    const line = doc.lineAt(pos);
    if (line.length === 0 && !cursorLines.has(line.number) && !isInsideCodeBlock(view, line.from)) {
      const nextStart = line.to + 1;
      const nextIsBlank =
        nextStart <= docEnd && doc.lineAt(nextStart).length === 0;
      if (!nextIsBlank) {
        decos.push(blankLineDeco.range(line.from));
      }
    }
    if (line.to + 1 <= pos) break;
    pos = line.to + 1;
  }

  // Prefer ensured (complete) tree; fall back to whatever's parsed so far.
  // Some transitions can return an empty ensured tree, so require length > 0.
  const ensured = ensureSyntaxTree(view.state, docEnd, 250);
  const tree = ensured && ensured.length > 0 ? ensured : syntaxTree(view.state);
  tree.iterate({
    from: 0,
    to: docEnd,
    enter: (node) => {
      const name = node.name;
      const line = doc.lineAt(node.from);
      const lineActive = cursorLines.has(line.number);

      if (headingLineDeco[name]) {
        decos.push(headingLineDeco[name].range(line.from));
        if (!lineActive) {
          node.node.getChildren('HeaderMark').forEach((mark) => {
            let end = mark.to;
            if (doc.sliceString(end, end + 1) === ' ') end++;
            if (end > mark.from) decos.push(hideMark.range(mark.from, end));
          });
        }
        return;
      }

      // Images handled by `imageField` (StateField) below for the common
      // cases — bare `![alt](url)` and linked `[![alt](url)](link)` lines,
      // which need block decorations for the active-line "markdown above
      // image" rendering (ViewPlugins can't emit block decorations). Here
      // we only handle truly inline, mid-paragraph images (rare).
      if (name === 'Image' && !lineActive) {
        const line2 = doc.lineAt(node.from);
        const handledByField =
          BARE_IMG_LINE.test(line2.text) || LINKED_IMG_LINE.test(line2.text);
        if (!handledByField) {
          const text = doc.sliceString(node.from, node.to);
          const match = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(text);
          if (match) {
            const widget = new ImageWidget(match[1], match[2]);
            decos.push(Decoration.replace({ widget }).range(node.from, node.to));
          }
        }
        return;
      }

      if (name === 'Paragraph') {
        let insideList = false;
        for (let p = node.node.parent; p; p = p.parent) {
          if (p.name === 'ListItem') { insideList = true; break; }
        }
        const first = node.node.firstChild;
        const isImageOnly =
          !!first &&
          first.name === 'Image' &&
          !first.nextSibling &&
          first.from === node.from &&
          first.to === node.to;
        if (!insideList) {
          const startLine = doc.lineAt(node.from);
          const endLineNum = lastLineOf(doc, node);
          const endLine = doc.line(endLineNum);
          if (isImageOnly) {
            decos.push(imageParagraphStartDeco.range(startLine.from));
            decos.push(imageParagraphEndDeco.range(endLine.from));
          } else {
            decos.push(paragraphStartDeco.range(startLine.from));
            decos.push(paragraphEndDeco.range(endLine.from));
          }
        }
        return;
      }

      if (name === 'BulletList' || name === 'OrderedList') {
        let nested = false;
        for (let p = node.node.parent; p; p = p.parent) {
          if (p.name === 'BulletList' || p.name === 'OrderedList') {
            nested = true;
            break;
          }
        }
        const startLine = doc.lineAt(node.from);
        const endLineNum = lastLineOf(doc, node);
        const endLine = doc.line(endLineNum);
        decos.push((nested ? nestedListStartDeco : listStartLineDeco).range(startLine.from));
        if (endLine.number !== startLine.number) {
          decos.push((nested ? nestedListEndDeco : listEndLineDeco).range(endLine.from));
        }
        return;
      }

      if (name === 'ListItem') {
        const startLine = doc.lineAt(node.from).number;
        const endLine = lastLineOf(doc, node);
        for (let ln = startLine; ln <= endLine; ln++) {
          decos.push(listItemLineDeco.range(doc.line(ln).from));
        }
        if (!lineActive) {
          node.node.getChildren('ListMark').forEach((mark) => {
            let end = mark.to;
            if (doc.sliceString(end, end + 1) === ' ') end++;
            if (end > mark.from) decos.push(hideMark.range(mark.from, end));
          });
        }
        return;
      }

      if (!lineActive && (name === 'Emphasis' || name === 'StrongEmphasis')) {
        node.node.getChildren('EmphasisMark').forEach((mark) => {
          decos.push(hideMark.range(mark.from, mark.to));
        });
        return;
      }

      if (!lineActive && name === 'InlineCode') {
        node.node.getChildren('CodeMark').forEach((mark) => {
          decos.push(hideMark.range(mark.from, mark.to));
        });
        return;
      }

      // Escape sequences (`\.`, `\-`, etc.): hide the leading backslash so
      // the user sees `25.04.0` instead of `25\.04\.0`. The document is
      // unchanged; the backslash reappears when the cursor is on the line.
      if (name === 'Escape' && !lineActive) {
        decos.push(hideMark.range(node.from, node.from + 1));
        return;
      }

      // Link `[text](url)`: hide the brackets and URL so only the rendered
      // text is visible (same layout as view mode).
      if (name === 'Link' && !lineActive) {
        const marks = node.node.getChildren('LinkMark');
        if (marks.length >= 2) {
          decos.push(hideMark.range(marks[1].from, node.to));
        }
        if (marks.length >= 1) {
          decos.push(hideMark.range(marks[0].from, marks[0].to));
        }
        return;
      }
    },
  });

  return Decoration.set(decos, true);
}

const richMarkdownPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations }
);

/**
 * Full-line image decorations, handled via a StateField so we can emit block
 * decorations (which `ViewPlugin` cannot). Behaviour:
 *   - Line NOT active: inline replace → image is shown in place of the raw
 *     `![alt](url)` markdown.
 *   - Line IS active (cursor on it): raw markdown stays visible AND a block
 *     widget is inserted AFTER the line rendering the image below. This is
 *     the Obsidian behaviour the user wants: clicking an image reveals its
 *     markdown above the image rather than making the image disappear.
 */
function buildImageBlockDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const activeLineNumbers = new Set<number>();
  for (const r of state.selection.ranges) {
    const fromLine = doc.lineAt(r.from).number;
    const toLine = doc.lineAt(r.to).number;
    for (let n = fromLine; n <= toLine; n++) activeLineNumbers.add(n);
  }
  const ranges: Range<Decoration>[] = [];
  const lineCount = doc.lines;
  for (let ln = 1; ln <= lineCount; ln++) {
    const line = doc.line(ln);
    const match = BARE_IMG_LINE.exec(line.text) ?? LINKED_IMG_LINE.exec(line.text);
    if (!match) continue;
    const widget = new ImageWidget(match[1], match[2]);
    if (activeLineNumbers.has(line.number)) {
      // Raw markdown stays visible on the line; image appears as a block
      // widget below it.
      ranges.push(
        Decoration.widget({ widget, side: 1, block: true }).range(line.to)
      );
    } else {
      // Inactive: replace the whole line with the image. Using line.from..
      // line.to (not node.from..node.to) ensures linked-images collapse too.
      ranges.push(Decoration.replace({ widget }).range(line.from, line.to));
    }
  }
  return Decoration.set(ranges, true);
}

const imageField = StateField.define<DecorationSet>({
  create(state) {
    return buildImageBlockDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildImageBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Image click handler.
//
// Clicks on an image widget place the caret on the image's source line,
// which flips `imageField`'s rendering from inline-replace to raw-
// markdown-above-block-widget so the user can edit the URL / alt text.
//
// Two things that don't work, as background for why this is structured
// the way it is:
//   - `mousedown` + `dispatch` + `return false`: CM's own mousedown runs
//     after and re-queries `posAtCoords` against the *rebuilt* layout,
//     dispatching a different selection (some line above the image).
//     That second dispatch wins.
//   - `click`/`mouseup`: the IMG is detached during the rebuild so
//     mouseup fires outside cm-content and the browser never dispatches
//     a matching click.
//
// So: synchronous dispatch from mousedown + preventDefault + return true
// so CM's handler loop breaks *before* basicMouseSelection runs (the
// `if (event.defaultPrevented) break;` inside `runHandlers`).
//
// That alone leaves a known tradeoff: the decoration swap makes CM's
// heightmap disagree with the DOM until the next measure cycle, so the
// *next* click on another line can resolve to a stale pos via
// `posAtCoords`. `armNextClickDomResolver` protects that very next
// click by resolving its position from live DOM instead — see below.
const imageClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target?.classList.contains('cm-md-img')) return false;
    const pos = view.posAtDOM(target);
    view.dispatch({ selection: { anchor: pos } });
    event.preventDefault();
    armNextClickDomResolver(view);
    return true;
  },
});

// One-shot capture-phase mousedown listener armed right after an image
// click. For the VERY NEXT click only, it resolves the target caret
// position from live DOM (`elementFromPoint` + `caretRangeFromPoint` +
// `posFromDOM`) instead of CM's `posAtCoords`, which consults the
// heightmap — still stale for a frame or two after the image's
// decoration swap, so its answer lands on the wrong line. Once it
// handles a click (or bails on a modifier-key/image click), it disarms.
function armNextClickDomResolver(view: EditorView) {
  const content = view.contentDOM;
  const cleanup = () => {
    content.removeEventListener('mousedown', handler, true);
  };
  const handler = (e: MouseEvent) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) {
      cleanup();
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!el) { cleanup(); return; }
    if (el.classList?.contains('cm-md-img')) { cleanup(); return; }
    let line: HTMLElement | null = el;
    while (line && !line.classList?.contains('cm-line')) line = line.parentElement;
    cleanup();
    if (!line) return;
    const pos = resolvePosFromPoint(view, line, e.clientX, e.clientY);
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
    // Stop CM's own mousedown from dispatching via the stale heightmap.
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  content.addEventListener('mousedown', handler, true);
}

function resolvePosFromPoint(
  view: EditorView,
  line: HTMLElement,
  x: number,
  y: number,
): number {
  const doc = document as any;
  const getRange: (x: number, y: number) => globalThis.Range | null =
    doc.caretRangeFromPoint?.bind(doc) ??
    ((ax: number, ay: number) => {
      const p = doc.caretPositionFromPoint?.(ax, ay);
      if (!p) return null;
      const r = document.createRange();
      r.setStart(p.offsetNode, p.offset);
      r.collapse(true);
      return r;
    });
  const range = getRange(x, y);
  if (range) {
    const { startContainer, startOffset } = range;
    // Guard: make sure the resolved node is inside our cm-line (some
    // browsers can return nodes outside when clicking in padding/margin).
    if (line.contains(startContainer)) {
      try {
        return (view as any).docView.posFromDOM(startContainer, startOffset);
      } catch {
        /* fall through to line-start fallback */
      }
    }
  }
  return view.posAtDOM(line);
}

/**
 * Collapse accidental selections caused by hidden markdown expanding under
 * the cursor.
 *
 * Problem: when the user clicks inside a paragraph containing a link, the
 * mousedown lands at doc-pos A (computed against the collapsed visible
 * text). CM dispatches that selection, which flips the line to "active" and
 * reveals the previously-hidden `[...](...)` syntax. The line's visible
 * characters shift. Mouseup fires on the same *screen* coordinate, which
 * now maps to doc-pos B (≠ A). CM treats A..B as a drag-selection and the
 * user sees a chunk of text highlighted despite only clicking once.
 *
 * Fix: if the mouse didn't actually move between mousedown and mouseup
 * (within a small pixel threshold) and CM nevertheless produced a range
 * selection, collapse it back to the anchor. Real drag-selections — where
 * the pointer genuinely moved — are untouched.
 */
const clickCollapseHandler = (() => {
  let downX = 0, downY = 0, downShift = false;
  return EditorView.domEventHandlers({
    mousedown(event) {
      if (event.button !== 0) return false;
      downX = event.clientX;
      downY = event.clientY;
      // Shift/meta at mousedown means the user is extending or block-
      // selecting on purpose — don't collapse on mouseup.
      downShift = event.shiftKey || event.metaKey || event.ctrlKey || event.altKey;
      return false;
    },
    mouseup(event, view) {
      if (event.button !== 0) return false;
      if (downShift || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
        return false;
      }
      const moved = Math.hypot(event.clientX - downX, event.clientY - downY);
      // Threshold of 4px covers sub-pixel rounding and a small "accidental
      // drift" during click. Anything more was a deliberate drag.
      if (moved > 4) return false;
      // Only collapse if CM produced a range (not a simple caret).
      const sel = view.state.selection.main;
      if (sel.from === sel.to) return false;
      // Collapse to the head (where the mouseup landed) — matches what the
      // user meant when they single-clicked.
      view.dispatch({ selection: { anchor: sel.head } });
      return false;
    },
  });
})();

export function richMarkdown(): Extension {
  return [imageField, richMarkdownPlugin, imageClickHandler, clickCollapseHandler];
}
