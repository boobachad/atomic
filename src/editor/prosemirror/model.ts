export type ProsemirrorEvalNodeKind =
  | 'doc'
  | 'paragraph'
  | 'heading'
  | 'blockquote'
  | 'ordered_list'
  | 'bullet_list'
  | 'list_item'
  | 'code_block'
  | 'image'
  | 'horizontal_rule'
  | 'text';

export type ProsemirrorEvalMarkKind =
  | 'strong'
  | 'em'
  | 'code'
  | 'link';

/**
 * Target document model for the ProseMirror foundation evaluation.
 *
 * This is intentionally framework-agnostic. It records the minimum
 * schema contract the evaluation has to satisfy before we commit to a
 * migration path.
 */
export interface ProsemirrorEvalModelContract {
  nodes: readonly ProsemirrorEvalNodeKind[];
  marks: readonly ProsemirrorEvalMarkKind[];
  markdownSourceOfTruth: true;
  singleMountedSurface: true;
  rendererSwapAllowed: false;
}

export const PROSEMIRROR_EVAL_MODEL: ProsemirrorEvalModelContract = {
  nodes: [
    'doc',
    'paragraph',
    'heading',
    'blockquote',
    'ordered_list',
    'bullet_list',
    'list_item',
    'code_block',
    'image',
    'horizontal_rule',
    'text',
  ],
  marks: ['strong', 'em', 'code', 'link'],
  markdownSourceOfTruth: true,
  singleMountedSurface: true,
  rendererSwapAllowed: false,
};
