import { memo } from 'react';
import { WikiArticleSummary, SuggestedArticle } from '../../stores/wiki';
import { formatRelativeDate, formatShortRelativeDate } from '../../lib/date';

interface WikiArticleCardProps {
  type: 'article';
  article: WikiArticleSummary;
  onClick: () => void;
}

interface WikiSuggestionCardProps {
  type: 'suggestion';
  suggestion: SuggestedArticle;
  onClick: () => void;
}

type WikiCardProps = WikiArticleCardProps | WikiSuggestionCardProps;

export const WikiCard = memo(function WikiCard(props: WikiCardProps) {
  if (props.type === 'suggestion') {
    const { suggestion, onClick } = props;
    return (
      <div
        onClick={onClick}
        className="relative flex flex-col p-4 border border-dashed border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-card)]/50 transition-all duration-150 h-full min-w-0 overflow-hidden group"
      >
        <div className="flex-1 min-h-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-1">
              {suggestion.tag_name}
            </p>
            <svg className="w-4 h-4 text-[var(--color-accent)] shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-2 leading-relaxed">
            Generate a wiki article from {suggestion.atom_count} atom{suggestion.atom_count !== 1 ? 's' : ''}
            {suggestion.mention_count > 0 && (
              <> and {suggestion.mention_count} mention{suggestion.mention_count !== 1 ? 's' : ''}</>
            )}
          </p>
        </div>
        <div className="mt-3 pt-3 border-t border-dashed border-[var(--color-border)]">
          <span className="text-xs font-medium text-[var(--color-accent)] group-hover:text-[var(--color-accent-light)] transition-colors">
            Generate article
          </span>
        </div>
      </div>
    );
  }

  const { article, onClick } = props;

  return (
    <div
      onClick={onClick}
      className="relative flex flex-col p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg cursor-pointer hover:border-[var(--color-border-hover)] hover:bg-[var(--color-bg-hover)] transition-all duration-150 h-full min-w-0 overflow-hidden break-words"
    >
      <div className="flex-1 min-h-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-[var(--color-text-primary)] line-clamp-1 min-w-0">
            {article.tag_name}
          </p>
          <span className="text-xs text-[var(--color-text-tertiary)] shrink-0" title={formatRelativeDate(article.updated_at)}>
            {formatShortRelativeDate(article.updated_at)}
          </span>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)]">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            {article.atom_count} source{article.atom_count !== 1 ? 's' : ''}
          </span>
          {article.inbound_links > 0 && (
            <span className="flex items-center gap-1 text-xs text-[var(--color-accent-light)]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              {article.inbound_links} link{article.inbound_links !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}, (prev, next) => {
  if (prev.type !== next.type) return false;
  if (prev.type === 'article' && next.type === 'article') {
    return prev.article.id === next.article.id
      && prev.article.updated_at === next.article.updated_at
      && prev.article.atom_count === next.article.atom_count
      && prev.article.inbound_links === next.article.inbound_links;
  }
  if (prev.type === 'suggestion' && next.type === 'suggestion') {
    return prev.suggestion.tag_id === next.suggestion.tag_id
      && prev.suggestion.atom_count === next.suggestion.atom_count;
  }
  return false;
});
