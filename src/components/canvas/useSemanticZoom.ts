import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasLevel } from '../../lib/api';
import { getCanvasLevel } from '../../lib/api';
import type { HierarchicalSimNode } from './useHierarchicalForceSimulation';
import { computeMiniLayout } from './useMiniForceSimulation';

const EXPAND_SCALE_FACTOR = 2.5;
const COLLAPSE_SCALE_FACTOR = 1.8;
const DEBOUNCE_MS = 50;
const PREFETCH_HOVER_MS = 300;
const EXPAND_RADIUS = 120; // radius for expanded atom positions

interface SemanticZoomProps {
  simNodes: HierarchicalSimNode[];
  dimensions: { width: number; height: number };
  initialScale: number;
  currentLevel: CanvasLevel | null;
}

interface SemanticZoomResult {
  onTransformed: (ref: unknown, state: { scale: number; positionX: number; positionY: number }) => void;
  expandedClusterId: string | null;
  expandedSimNodes: HierarchicalSimNode[];
  expansionProgress: number;
  prefetchCluster: (clusterId: string, childrenIds: string[]) => void;
  isExpandLoading: boolean;
}

export function useSemanticZoom({
  simNodes,
  dimensions,
  initialScale,
  currentLevel,
}: SemanticZoomProps): SemanticZoomResult {
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [expansionProgress, setExpansionProgress] = useState(0);
  const [expandedSimNodes, setExpandedSimNodes] = useState<HierarchicalSimNode[]>([]);
  const [isExpandLoading, setIsExpandLoading] = useState(false);

  const childrenCacheRef = useRef(new Map<string, CanvasLevel>());
  const transformRef = useRef({ scale: initialScale, positionX: 0, positionY: 0 });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animationRef = useRef<number | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when the navigation level changes
  useEffect(() => {
    setExpandedClusterId(null);
    setExpansionProgress(0);
    setExpandedSimNodes([]);
    childrenCacheRef.current.clear();
  }, [currentLevel]);

  // Find the cluster nearest to viewport center
  const findFocusedCluster = useCallback(
    (scale: number, posX: number, posY: number): HierarchicalSimNode | null => {
      const vpCenterX = dimensions.width / 2;
      const vpCenterY = dimensions.height / 2;

      let best: HierarchicalSimNode | null = null;
      let bestDist = Infinity;

      for (const sn of simNodes) {
        const node = sn.canvasNode;
        // Only clusters/tags with children can expand
        if (node.node_type === 'atom') continue;
        if (!node.children_ids || node.children_ids.length === 0) continue;

        // Transform canvas position to screen position
        const screenX = sn.x * scale + posX;
        const screenY = sn.y * scale + posY;
        const dist = Math.sqrt((screenX - vpCenterX) ** 2 + (screenY - vpCenterY) ** 2);

        if (dist < bestDist) {
          bestDist = dist;
          best = sn;
        }
      }

      // Only focus if reasonably close to center (within half the viewport)
      const maxDist = Math.min(dimensions.width, dimensions.height) * 0.5;
      return bestDist < maxDist ? best : null;
    },
    [simNodes, dimensions],
  );

  // Expand a cluster
  const expandCluster = useCallback(
    async (clusterId: string, childrenIds: string[], clusterPos: { x: number; y: number }) => {
      setIsExpandLoading(true);

      let level = childrenCacheRef.current.get(clusterId);
      if (!level) {
        try {
          level = await getCanvasLevel(clusterId, childrenIds);
          childrenCacheRef.current.set(clusterId, level);
        } catch {
          setIsExpandLoading(false);
          return;
        }
      }

      setIsExpandLoading(false);

      // Position children around the cluster's location
      const childNodes = level.nodes;
      const positions = computeMiniLayout(
        childNodes.length,
        clusterPos,
        EXPAND_RADIUS,
        20, // larger collision radius for full cards
      );

      const newSimNodes: HierarchicalSimNode[] = childNodes.map((node, i) => ({
        id: node.id,
        canvasNode: node,
        x: positions[i]?.x ?? clusterPos.x,
        y: positions[i]?.y ?? clusterPos.y,
      }));

      setExpandedClusterId(clusterId);
      setExpandedSimNodes(newSimNodes);

      // Animate expansion
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      const startTime = performance.now();
      const duration = 200;
      const animate = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        // Ease out cubic
        const eased = 1 - (1 - t) ** 3;
        setExpansionProgress(eased);
        if (t < 1) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };
      animationRef.current = requestAnimationFrame(animate);
    },
    [],
  );

  // Collapse expanded cluster
  const collapseCluster = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    const startTime = performance.now();
    const duration = 150;
    const animate = (now: number) => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = 1 - t; // linear fade out
      setExpansionProgress(eased);
      if (t < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setExpandedClusterId(null);
        setExpandedSimNodes([]);
      }
    };
    animationRef.current = requestAnimationFrame(animate);
  }, []);

  // Handle transform changes
  const onTransformed = useCallback(
    (_ref: unknown, state: { scale: number; positionX: number; positionY: number }) => {
      transformRef.current = state;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const { scale, positionX, positionY } = state;
        const expandThreshold = initialScale * EXPAND_SCALE_FACTOR;
        const collapseThreshold = initialScale * COLLAPSE_SCALE_FACTOR;

        if (scale >= expandThreshold && !expandedClusterId) {
          // Find and expand the focused cluster
          const focused = findFocusedCluster(scale, positionX, positionY);
          if (focused) {
            expandCluster(
              focused.canvasNode.id,
              focused.canvasNode.children_ids,
              { x: focused.x, y: focused.y },
            );
          }
        } else if (scale < collapseThreshold && expandedClusterId) {
          collapseCluster();
        }
      }, DEBOUNCE_MS);
    },
    [initialScale, expandedClusterId, findFocusedCluster, expandCluster, collapseCluster],
  );

  // Prefetch on hover
  const prefetchCluster = useCallback((clusterId: string, childrenIds: string[]) => {
    if (childrenCacheRef.current.has(clusterId)) return;
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = setTimeout(async () => {
      try {
        const level = await getCanvasLevel(clusterId, childrenIds);
        childrenCacheRef.current.set(clusterId, level);
      } catch {
        // Silently fail prefetch
      }
    }, PREFETCH_HOVER_MS);
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
    };
  }, []);

  return {
    onTransformed,
    expandedClusterId,
    expandedSimNodes,
    expansionProgress,
    prefetchCluster,
    isExpandLoading,
  };
}
