import { baseKeymap, chainCommands, exitCode, joinUp, lift, newlineInCode, selectParentNode, setBlockType } from 'prosemirror-commands';
import type { Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';

export function buildProsemirrorEvalKeymaps(schema: Schema) {
  const keymaps = [];
  const listItem = schema.nodes.list_item;
  const headingBackspace = createHeadingBackspaceCommand(schema);

  if (listItem) {
    keymaps.push(
      keymap({
        Enter: chainCommands(newlineInCode, splitListItem(listItem)),
        Tab: sinkListItem(listItem),
        'Shift-Tab': liftListItem(listItem),
      })
    );
  }

  keymaps.push(
    keymap({
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
      'Mod-Alt-0': schema.nodes.paragraph ? setBlockType(schema.nodes.paragraph) : () => false,
      'Mod-Alt-1': schema.nodes.heading ? setBlockType(schema.nodes.heading, { level: 1 }) : () => false,
      'Mod-Alt-2': schema.nodes.heading ? setBlockType(schema.nodes.heading, { level: 2 }) : () => false,
      'Mod-Alt-3': schema.nodes.heading ? setBlockType(schema.nodes.heading, { level: 3 }) : () => false,
      'Mod-Alt-4': schema.nodes.heading ? setBlockType(schema.nodes.heading, { level: 4 }) : () => false,
      'Mod-Alt-5': schema.nodes.heading ? setBlockType(schema.nodes.heading, { level: 5 }) : () => false,
      'Mod-Alt-6': schema.nodes.heading ? setBlockType(schema.nodes.heading, { level: 6 }) : () => false,
      Backspace: chainCommands(headingBackspace, exitCode, joinUp, lift),
      Escape: selectParentNode,
    })
  );

  keymaps.push(keymap(baseKeymap));
  return keymaps;
}

function createHeadingBackspaceCommand(schema: Schema): Command {
  const heading = schema.nodes.heading;
  const paragraph = schema.nodes.paragraph;

  if (!heading || !paragraph) return () => false;

  return (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) return false;

    const { $from } = selection;
    if ($from.parent.type !== heading) return false;
    if ($from.parentOffset !== 0) return false;

    const level = typeof $from.parent.attrs.level === 'number' ? $from.parent.attrs.level : 1;
    const pos = $from.before();
    const tr = state.tr;

    if (level > 1) {
      tr.setNodeMarkup(pos, heading, { level: level - 1 });
    } else {
      tr.setNodeMarkup(pos, paragraph);
    }

    if (dispatch) dispatch(tr);
    return true;
  };
}
