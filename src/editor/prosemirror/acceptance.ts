export interface ProsemirrorEvalAcceptanceCriterion {
  id: string;
  category: 'correctness' | 'stability' | 'performance' | 'architecture';
  description: string;
}

/**
 * Production acceptance contract for the ProseMirror evaluation.
 *
 * The evaluation should not drift into "it looks promising". These are
 * the baseline criteria the editor foundation needs to satisfy before
 * it is considered a credible successor to the current CodeMirror path.
 */
export const PROSEMIRROR_EVAL_ACCEPTANCE: readonly ProsemirrorEvalAcceptanceCriterion[] = [
  {
    id: 'markdown-roundtrip',
    category: 'correctness',
    description: 'Representative Atomic notes round-trip through the editor without unacceptable markdown drift.',
  },
  {
    id: 'single-surface',
    category: 'architecture',
    description: 'Reader-like and editor-like interactions run through one mounted ProseMirror surface.',
  },
  {
    id: 'no-renderer-swap',
    category: 'architecture',
    description: 'The evaluation does not depend on swapping between separate reader and editor layout engines.',
  },
  {
    id: 'stable-image-interaction',
    category: 'stability',
    description: 'Interacting with image blocks does not cause large scroll jumps or cursor misplacement.',
  },
  {
    id: 'stable-code-block-interaction',
    category: 'stability',
    description: 'Entering and editing code blocks does not destabilize surrounding layout.',
  },
  {
    id: 'large-atom-viability',
    category: 'performance',
    description: 'Large representative atoms remain responsive without a viewport patch equivalent to the current CodeMirror override.',
  },
  {
    id: 'local-command-ownership',
    category: 'architecture',
    description: 'Document commands can be owned by the document surface rather than bridged through ambient global state.',
  },
];
