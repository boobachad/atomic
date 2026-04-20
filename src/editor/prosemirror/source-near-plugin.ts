import type { Node as ProsemirrorNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

const sourceNearPluginKey = new PluginKey<{
  focused: boolean;
  mouseDown: boolean;
}>('source-near');

function getActiveTextblockInfo(doc: ProsemirrorNode, selectionFrom: number) {
  const $from = doc.resolve(selectionFrom);

  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (!node.isTextblock) continue;

    const prefix = getMarkdownPrefix($from, depth);
    return {
      from: $from.before(depth),
      to: $from.after(depth),
      contentFrom: $from.start(depth),
      contentTo: $from.end(depth),
      nodeName: node.type.name,
      node,
      prefix,
    };
  }

  return null;
}

function getMarkdownPrefix($from: ReturnType<ProsemirrorNode['resolve']>, depth: number): string {
  const node = $from.node(depth);

  if (node.type.name === 'heading') {
    const level = typeof node.attrs.level === 'number' ? node.attrs.level : 1;
    return `${'#'.repeat(level)} `;
  }

  if (node.type.name === 'code_block') {
    return '```';
  }

  for (let d = depth - 1; d >= 0; d--) {
    const ancestor = $from.node(d);
    if (ancestor.type.name === 'blockquote') {
      return '> ';
    }
    if (ancestor.type.name === 'bullet_list') {
      return '- ';
    }
    if (ancestor.type.name === 'ordered_list') {
      const order = typeof ancestor.attrs.order === 'number' ? ancestor.attrs.order : 1;
      return `${order}. `;
    }
  }

  return '';
}

export function createSourceNearPlugin() {
  return new Plugin({
    key: sourceNearPluginKey,
    state: {
      init(): { focused: boolean; mouseDown: boolean } {
        return { focused: false, mouseDown: false };
      },
      apply(tr, value: { focused: boolean; mouseDown: boolean }) {
        const meta = tr.getMeta(sourceNearPluginKey);
        let next: { focused: boolean; mouseDown: boolean } = value;

        if (meta && typeof meta === 'object') {
          if (typeof meta.focused === 'boolean') {
            next = { ...next, focused: meta.focused };
          }
          if (typeof meta.mouseDown === 'boolean') {
            next = { ...next, mouseDown: meta.mouseDown };
          }
        }

        return next;
      },
    },
    props: {
      handleDOMEvents: {
        mousedown(view, event) {
          if (!(event instanceof MouseEvent)) return false;

          view.dispatch(view.state.tr.setMeta(sourceNearPluginKey, { mouseDown: true }));
          return false;
        },
        mouseup(view) {
          view.dispatch(view.state.tr.setMeta(sourceNearPluginKey, { mouseDown: false }));
          return false;
        },
        focus(view) {
          view.dispatch(view.state.tr.setMeta(sourceNearPluginKey, { focused: true }));
          return false;
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta(sourceNearPluginKey, { focused: false, mouseDown: false }));
          return false;
        },
      },
      decorations(state) {
        const pluginState = sourceNearPluginKey.getState(state);
        if (!pluginState?.focused) return DecorationSet.empty;

        const active = getActiveTextblockInfo(state.doc, state.selection.anchor);
        if (!active) return DecorationSet.empty;

        const decorations: Decoration[] = [
          Decoration.node(active.from, active.to, getActiveBlockAttrs(active)),
        ];

        if (active.nodeName === 'code_block') {
          decorations.push(
            Decoration.widget(active.contentFrom, () => createMarker('pm-eval-md-fence', '```'), {
              side: -1,
            }),
            Decoration.widget(active.contentTo, () => createMarker('pm-eval-md-fence', '```'), {
              side: 1,
            })
          );
        } else if (active.prefix && active.nodeName !== 'heading') {
          decorations.push(
            Decoration.widget(active.contentFrom, () => createMarker('pm-eval-md-prefix', active.prefix), {
              side: -1,
            })
          );
        }

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

function createMarker(className: string, text: string) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  span.contentEditable = 'false';
  return span;
}

function getActiveBlockAttrs(_active: NonNullable<ReturnType<typeof getActiveTextblockInfo>>) {
  const attrs: Record<string, string> = {
    class: 'pm-eval-active-block',
  };

  return attrs;
}
