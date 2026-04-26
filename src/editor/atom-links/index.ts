import { wikiLinks, type WikiLinkSuggestion } from '@atomic-editor/editor';
import type { Extension } from '@codemirror/state';

export type AtomLinkSuggestionSource = 'recent' | 'title' | 'content' | 'hybrid';

export interface AtomLinkSuggestion {
  id: string;
  title: string;
  snippet?: string | null;
  source?: AtomLinkSuggestionSource;
}

export interface ResolvedAtomLinkTarget {
  id: string;
  title: string;
  snippet?: string | null;
}

export interface AtomLinkExtensionConfig {
  currentAtomId?: string;
  suggestAtoms: (query: string) => Promise<AtomLinkSuggestion[]>;
  resolveAtom?: (id: string) => Promise<ResolvedAtomLinkTarget | null>;
  openAtom?: (id: string) => void;
  maxSuggestions?: number;
}

export function atomLinkExtension(config: AtomLinkExtensionConfig): Extension[] {
  return [
    wikiLinks({
      suggest: async (query) => {
        const suggestions = await config.suggestAtoms(query);
        return suggestions
          .filter((suggestion) => suggestion.id !== config.currentAtomId)
          .map((suggestion) => ({
            target: suggestion.id,
            label: displayTitle(suggestion.title),
            detail: suggestion.source ? sourceLabel(suggestion.source) : undefined,
            boost: suggestion.source === 'title' || suggestion.source === 'recent' ? 20 : 0,
          }));
      },
      resolve: config.resolveAtom
        ? async (target) => {
            if (!isUuidTarget(target)) return null;
            const atom = await config.resolveAtom!(target);
            if (!atom) {
              return { target, label: 'Missing atom', status: 'missing' };
            }
            return { target, label: displayTitle(atom.title), status: 'resolved' };
          }
        : undefined,
      onOpen: config.openAtom,
      openOnClick: true,
      serializeSuggestion,
      shouldResolve: isUuidTarget,
      maxSuggestions: config.maxSuggestions,
    }),
  ];
}

function isUuidTarget(target: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(target.trim());
}

function serializeSuggestion(suggestion: WikiLinkSuggestion): string {
  return `${suggestion.target}|${escapeLabel(suggestion.label)}]]`;
}

function sourceLabel(source: AtomLinkSuggestionSource): string {
  switch (source) {
    case 'recent':
      return 'Recent';
    case 'title':
      return 'Title';
    case 'content':
      return 'Content';
    case 'hybrid':
      return 'Related';
  }
}

function displayTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : 'Untitled atom';
}

function escapeLabel(label: string): string {
  return label.replace(/[\]\|]/g, ' ').replace(/\s+/g, ' ').trim();
}
