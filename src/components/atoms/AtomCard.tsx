import { AtomWithTags } from '../../stores/atoms';
import { TagChip } from '../tags/TagChip';
import { truncateContent } from '../../lib/markdown';
import { formatRelativeDate } from '../../lib/date';

interface AtomCardProps {
  atom: AtomWithTags;
  onClick: () => void;
  viewMode: 'grid' | 'list';
}

export function AtomCard({ atom, onClick, viewMode }: AtomCardProps) {
  const preview = truncateContent(atom.content, 150);
  const visibleTags = atom.tags.slice(0, 3);
  const remainingTags = atom.tags.length - 3;

  if (viewMode === 'list') {
    return (
      <div
        onClick={onClick}
        className="flex items-center gap-4 p-4 bg-[#2d2d2d] border border-[#3d3d3d] rounded-lg cursor-pointer hover:border-[#4d4d4d] hover:bg-[#333333] transition-all duration-150"
      >
        <div className="flex-1 min-w-0">
          <p className="text-[#dcddde] text-sm line-clamp-1">{preview}</p>
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
      className="flex flex-col p-4 bg-[#2d2d2d] border border-[#3d3d3d] rounded-lg cursor-pointer hover:border-[#4d4d4d] hover:bg-[#333333] transition-all duration-150 h-full"
    >
      <div className="flex-1 min-h-0">
        <p className="text-[#dcddde] text-sm line-clamp-4 leading-relaxed">
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

