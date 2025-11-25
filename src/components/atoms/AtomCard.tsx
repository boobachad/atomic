import { AtomWithTags } from '../../stores/atoms';
import { TagChip } from '../tags/TagChip';
import { truncateContent } from '../../lib/markdown';
import { formatRelativeDate } from '../../lib/date';

interface AtomCardProps {
  atom: AtomWithTags;
  onClick: () => void;
  viewMode: 'grid' | 'list';
  matchingChunkContent?: string;  // For search results
  onRetryEmbedding?: () => void;  // For retry action
}

function EmbeddingStatusIndicator({
  status,
  onRetry,
}: {
  status: AtomWithTags['embedding_status'];
  onRetry?: () => void;
}) {
  if (status === 'complete') {
    return null;
  }

  if (status === 'pending' || status === 'processing') {
    return (
      <div
        className="absolute top-2 right-2 w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse"
        title={status === 'pending' ? 'Embedding pending' : 'Embedding in progress'}
      />
    );
  }

  if (status === 'failed') {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRetry?.();
        }}
        className="absolute top-2 right-2 text-red-500 hover:text-red-400 transition-colors"
        title="Embedding failed - click to retry"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </button>
    );
  }

  return null;
}

export function AtomCard({
  atom,
  onClick,
  viewMode,
  matchingChunkContent,
  onRetryEmbedding,
}: AtomCardProps) {
  // Use matching chunk content for search results, otherwise use truncated content
  const preview = matchingChunkContent
    ? matchingChunkContent.length > 200
      ? matchingChunkContent.slice(0, 200) + '...'
      : matchingChunkContent
    : truncateContent(atom.content, 150);

  const visibleTags = atom.tags.slice(0, 3);
  const remainingTags = atom.tags.length - 3;

  if (viewMode === 'list') {
    return (
      <div
        onClick={onClick}
        className="relative flex items-center gap-4 p-4 bg-[#2d2d2d] border border-[#3d3d3d] rounded-lg cursor-pointer hover:border-[#4d4d4d] hover:bg-[#333333] transition-all duration-150"
      >
        <EmbeddingStatusIndicator
          status={atom.embedding_status}
          onRetry={onRetryEmbedding}
        />
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm line-clamp-1 ${
              matchingChunkContent ? 'text-[#a78bfa]' : 'text-[#dcddde]'
            }`}
          >
            {preview}
          </p>
          {atom.tags.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2">
              {visibleTags.map((tag) => (
                <TagChip key={tag.id} name={tag.name} size="sm" />
              ))}
              {remainingTags > 0 && (
                <span className="text-xs text-[#666666]">+{remainingTags} more</span>
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-[#666666] whitespace-nowrap">
          {formatRelativeDate(atom.created_at)}
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="relative flex flex-col p-4 bg-[#2d2d2d] border border-[#3d3d3d] rounded-lg cursor-pointer hover:border-[#4d4d4d] hover:bg-[#333333] transition-all duration-150 h-full"
    >
      <EmbeddingStatusIndicator
        status={atom.embedding_status}
        onRetry={onRetryEmbedding}
      />
      <div className="flex-1 min-h-0">
        <p
          className={`text-sm line-clamp-4 leading-relaxed ${
            matchingChunkContent ? 'text-[#a78bfa]' : 'text-[#dcddde]'
          }`}
        >
          {preview}
        </p>
      </div>
      <div className="mt-3 pt-3 border-t border-[#3d3d3d]">
        {atom.tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            {visibleTags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} size="sm" />
            ))}
            {remainingTags > 0 && (
              <span className="text-xs text-[#666666]">+{remainingTags}</span>
            )}
          </div>
        )}
        <span className="text-xs text-[#666666]">
          {formatRelativeDate(atom.created_at)}
        </span>
      </div>
    </div>
  );
}

