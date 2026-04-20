import { setBlockType } from 'prosemirror-commands';
import type { Command } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

export function setParagraphCommand(schema: Schema): Command {
  return schema.nodes.paragraph ? setBlockType(schema.nodes.paragraph) : () => false;
}

export function setHeadingCommand(schema: Schema, level: number): Command {
  return schema.nodes.heading
    ? setBlockType(schema.nodes.heading, { level })
    : () => false;
}

export function getCurrentBlockLabel(schema: Schema, nodeName: string, attrs: Record<string, unknown> | null | undefined): string {
  if (nodeName === schema.nodes.heading?.name) {
    const level = typeof attrs?.level === 'number' ? attrs.level : '?';
    return `H${level}`;
  }
  if (nodeName === schema.nodes.paragraph?.name) return 'Paragraph';
  if (nodeName === schema.nodes.blockquote?.name) return 'Blockquote';
  if (nodeName === schema.nodes.code_block?.name) return 'Code block';
  if (nodeName === schema.nodes.bullet_list?.name) return 'Bullet list';
  if (nodeName === schema.nodes.ordered_list?.name) return 'Ordered list';
  return nodeName;
}
