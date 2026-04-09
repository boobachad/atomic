import { memo, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { WikiArticleSummary, SuggestedArticle } from '../../stores/wiki';
import { WikiCard } from './WikiCard';
import { useContainerWidth } from '../../hooks/useContainerWidth';

const CARD_MIN_WIDTH = 260;
const CARD_GAP = 16;
const PADDING = 16;
const ROW_HEIGHT = 140;

interface WikiGridProps {
  articles: WikiArticleSummary[];
  suggestedArticles: SuggestedArticle[];
  onArticleClick: (tagId: string, tagName: string) => void;
  onSuggestionClick: (tagId: string, tagName: string) => void;
  isLoading?: boolean;
}

type GridItem =
  | { type: 'article'; article: WikiArticleSummary }
  | { type: 'suggestion'; suggestion: SuggestedArticle };

export const WikiGrid = memo(function WikiGrid({
  articles,
  suggestedArticles,
  onArticleClick,
  onSuggestionClick,
  isLoading,
}: WikiGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const containerWidth = useContainerWidth(parentRef);

  const ready = containerWidth > 0;
  const columnCount = ready
    ? Math.max(1, Math.floor((containerWidth - PADDING * 2 + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)))
    : 1;

  // Merge articles and suggestions into a single grid items list
  const gridItems: GridItem[] = useMemo(() => {
    const items: GridItem[] = articles.map(article => ({ type: 'article', article }));
    for (const suggestion of suggestedArticles) {
      items.push({ type: 'suggestion', suggestion });
    }
    return items;
  }, [articles, suggestedArticles]);

  const rowCount = Math.ceil(gridItems.length / columnCount);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
    gap: CARD_GAP,
    enabled: ready,
  });

  if (gridItems.length === 0 && isLoading) {
    return (
      <div ref={parentRef} className="h-full overflow-y-auto scrollbar-auto-hide p-4">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH}px, 1fr))`,
            gap: `${CARD_GAP}px`,
          }}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col p-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg h-[${ROW_HEIGHT}px]">
              <div className="flex-1">
                <div className="h-4 w-3/5 bg-[var(--color-border)] rounded animate-pulse" />
              </div>
              <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
                <div className="h-3 w-20 bg-[var(--color-border)] rounded animate-pulse opacity-50" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (gridItems.length === 0) {
    return (
      <div ref={parentRef} className="flex flex-col items-center justify-center h-full text-center p-8">
        <svg
          className="w-16 h-16 text-[var(--color-border)] mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
        <h3 className="text-lg font-medium text-[var(--color-text-primary)] mb-2">No wiki articles yet</h3>
        <p className="text-sm text-[var(--color-text-secondary)] max-w-sm">
          Generate a wiki article from your atoms to synthesize knowledge across related notes.
        </p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto scrollbar-auto-hide">
      <div
        className="relative w-full p-4"
        style={{ height: `${virtualizer.getTotalSize() + PADDING * 2}px` }}
      >
        {ready && virtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columnCount;
          const rowItems = gridItems.slice(startIndex, startIndex + columnCount);
          return (
            <div
              key={virtualRow.key}
              className="absolute left-4 right-4"
              style={{
                top: `${virtualRow.start}px`,
                height: `${virtualRow.size}px`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                gap: `${CARD_GAP}px`,
              }}
            >
              {rowItems.map((item) => {
                if (item.type === 'article') {
                  return (
                    <WikiCard
                      key={item.article.id}
                      type="article"
                      article={item.article}
                      onClick={() => onArticleClick(item.article.tag_id, item.article.tag_name)}
                    />
                  );
                } else {
                  return (
                    <WikiCard
                      key={`suggestion-${item.suggestion.tag_id}`}
                      type="suggestion"
                      suggestion={item.suggestion}
                      onClick={() => onSuggestionClick(item.suggestion.tag_id, item.suggestion.tag_name)}
                    />
                  );
                }
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
});
