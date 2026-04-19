import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorSelection, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { richMarkdown } from './codemirror-rich-markdown';

/**
 * "Seamless" CodeMirror theme for inline editing.
 * Matches the surrounding prose: same font, same background, no chrome.
 */
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    fontSize: 'inherit',
  },
  '.cm-content': {
    caretColor: 'var(--color-accent)',
    padding: '0',
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    fontSize: 'inherit',
    color: 'var(--color-text-primary)',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--color-accent)',
  },
  // Selection: CM ships its own
  //   `&light.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground
  //      { background: #d7d4f0 }`
  // rule which is *more specific* than a plain `.cm-selectionBackground`
  // override and therefore wins when the editor is focused. On our
  // `#1e1e1e` dark bg that pastel lavender reads as near-opaque light grey,
  // making white text on top unreadable. Match CM's selector depth so our
  // accent actually lands.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(124, 58, 237, 0.55)',
  },
  '::selection': {
    backgroundColor: 'rgba(124, 58, 237, 0.55)',
    color: 'var(--color-text-primary)',
  },
  '.cm-placeholder': {
    color: 'var(--color-text-tertiary)',
    fontStyle: 'italic',
  },
});

/**
 * Syntax highlighting using CSS variables from the design system.
 */
const highlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold', color: 'var(--color-text-primary)' },
  { tag: tags.strong, fontWeight: 'bold', color: 'var(--color-text-primary)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--color-text-primary)' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--color-text-secondary)' },
  { tag: tags.link, color: 'var(--color-text-primary)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--color-text-primary)', textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: 'var(--font-mono)', color: 'var(--color-accent-light)' },
  { tag: tags.content, color: 'var(--color-text-primary)' },
  { tag: tags.processingInstruction, color: 'var(--color-text-tertiary)' },
  { tag: tags.meta, color: 'var(--color-text-tertiary)' },
  { tag: tags.list, color: 'var(--color-text-secondary)' },
  { tag: tags.quote, color: 'var(--color-text-secondary)', fontStyle: 'italic' },
  { tag: tags.angleBracket, color: 'var(--color-text-tertiary)' },
  { tag: tags.tagName, color: 'var(--color-accent-light)' },
  { tag: tags.attributeName, color: 'var(--color-text-secondary)' },
  { tag: tags.attributeValue, color: 'var(--color-accent-light)' },
]);

// Exit-list-on-empty Enter handler.
//
// `@codemirror/lang-markdown`'s default `insertNewlineContinueMarkup`
// binding removes the bullet/number marker when you press Enter on an
// empty list item, then leaves the cursor on that now-empty line. The
// problem: markdown treats a non-blank line immediately after a list
// item as a lazy continuation of that item. So if the user types text
// straight after the exit (without inserting another blank line), the
// parser glues their text back into the list — and our `cm-md-li`
// decoration paints it as a bullet. The user sees "no dash but the
// text is indented and the behaviour is list-y".
//
// Fix: detect the exit-empty-list-item case ourselves and, instead of
// leaving the cursor on a bare empty line, emit an additional line
// break so there's a genuine blank line separating the list from the
// next content. Markdown then can't treat subsequent text as a lazy
// continuation.
const exitListOnEnter = (view: EditorView): boolean => {
  const { state } = view;
  const { main } = state.selection;
  if (!main.empty) return false;
  const line = state.doc.lineAt(main.head);
  // Only meaningful at the end of a line.
  if (main.head !== line.to) return false;
  // Line must contain just a list marker + optional trailing space,
  // meaning the user is on an empty list item about to exit the list.
  const markerOnly = /^\s*(?:[-*+]|\d+[.)])\s*$/.test(line.text);
  if (!markerOnly) return false;
  // Confirm via the syntax tree: cursor should be inside a ListItem.
  const tree = syntaxTree(state);
  let n: any = tree.resolveInner(main.head, -1);
  let inList = false;
  for (let cur = n; cur; cur = cur.parent) {
    if (cur.name === 'ListItem') { inList = true; break; }
  }
  if (!inList) return false;
  // Replace the marker-only line with nothing, and put the cursor two
  // line-breaks past the previous line's end — so there's a guaranteed
  // blank line between the list and whatever the user types next.
  const prevEnd = line.from - 1; // end of previous line (before our \n)
  if (prevEnd < 0) return false;
  view.dispatch({
    changes: { from: line.from, to: line.to, insert: '\n' },
    selection: EditorSelection.cursor(line.from + 1),
    userEvent: 'input.insert',
    scrollIntoView: true,
  });
  return true;
};

/** Get CodeMirror extensions for seamless inline markdown editing.
 *
 * Virtualisation is effectively disabled via the `VP.Margin` patch in
 * `patches/@codemirror+view+*.patch` — this makes `EditorView.lineWrapping`
 * + variable-height decorations (heading sizes, paragraph margins, image
 * widgets) stable. Without the patch CM would re-measure lines as they
 * scroll in and the heightmap would drift. */
export function getEditorExtensions() {
  return [
    // High-precedence Enter binding: runs BEFORE lang-markdown's
    // `insertNewlineContinueMarkup` so we can own the list-exit case.
    Prec.highest(keymap.of([{ key: 'Enter', run: exitListOnEnter }])),
    markdown(),
    editorTheme,
    syntaxHighlighting(highlightStyle),
    richMarkdown(),
    EditorView.lineWrapping,
  ];
}
