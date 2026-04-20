import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { Schema } from 'prosemirror-model';

function codeBlockRule(nodeType: Schema['nodes'][string]) {
  return new InputRule(/^```$/, (state, _match, start, end) => {
    if (!nodeType) return null;
    const { tr } = state;
    tr.delete(start, end);
    tr.setBlockType(start, start, nodeType);
    return tr;
  });
}

export function buildProsemirrorEvalInputRules(schema: Schema) {
  const rules = [];

  if (schema.nodes.heading) {
    rules.push(textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
      level: match[1].length,
    })));
  }

  if (schema.nodes.blockquote) {
    rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
  }

  if (schema.nodes.ordered_list) {
    rules.push(wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, (match) => ({
      order: Number(match[1]),
    })));
  }

  if (schema.nodes.bullet_list) {
    rules.push(wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list));
  }

  if (schema.nodes.code_block) {
    rules.push(codeBlockRule(schema.nodes.code_block));
  }

  return inputRules({ rules });
}
