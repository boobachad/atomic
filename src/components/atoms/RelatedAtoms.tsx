import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SimilarAtomResult } from '../../stores/atoms';

interface RelatedAtomsProps {
  atomId: string;
  onAtomClick: (atomId: string) => void;
}

export function RelatedAtoms({ atomId, onAtomClick }: RelatedAtomsProps) {
  const [relatedAtoms, setRelatedAtoms] = useState<SimilarAtomResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchRelated = async () => {
      setIsLoading(true);
      try {
        const results = await invoke<SimilarAtomResult[]>('find_similar_atoms', {
          atomId,
          limit: 5,
          threshold: 0.7,
        });
        setRelatedAtoms(results);
      } catch (error) {
        console.error('Failed to fetch related atoms:', error);
        setRelatedAtoms([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRelated();
  }, [atomId]);

  // Don't render if no related atoms
  if (!isLoading && relatedAtoms.length === 0) {
    return null;
  }

  return (
    <div className="border-t border-[#3d3d3d] px-6 py-4">
      <h3 className="text-sm font-medium text-[#888888] mb-3">Related Atoms</h3>

      {isLoading ? (
        <div className="text-sm text-[#666666]">Loading...</div>
      ) : (
        <div className="space-y-2">
          {relatedAtoms.map((result) => (
            <button
              key={result.id}
              onClick={() => onAtomClick(result.id)}
              className="w-full text-left p-3 bg-[#252525] rounded-md hover:bg-[#2d2d2d] transition-colors"
            >
              <p className="text-sm text-[#dcddde] line-clamp-2">
                {result.content.length > 100
                  ? result.content.slice(0, 100) + '...'
                  : result.content}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-[#7c3aed]">
                  {Math.round(result.similarity_score * 100)}% similar
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

