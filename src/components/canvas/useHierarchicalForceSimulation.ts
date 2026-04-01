import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3-force';
import type { CanvasNode, CanvasEdge } from '../../lib/api';

export interface HierarchicalSimNode extends d3.SimulationNodeDatum {
  id: string;
  canvasNode: CanvasNode;
  x: number;
  y: number;
}

interface SimLink extends d3.SimulationLinkDatum<HierarchicalSimNode> {
  source: string;
  target: string;
  strength: number;
}

interface UseHierarchicalForceSimulationProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  height: number;
}

interface UseHierarchicalForceSimulationResult {
  simNodes: HierarchicalSimNode[];
  isSimulating: boolean;
}

export function useHierarchicalForceSimulation({
  nodes,
  edges,
  width,
  height,
}: UseHierarchicalForceSimulationProps): UseHierarchicalForceSimulationResult {
  const [simNodes, setSimNodes] = useState<HierarchicalSimNode[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationRef = useRef<d3.Simulation<HierarchicalSimNode, undefined> | null>(null);

  useEffect(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }

    if (nodes.length === 0 || width === 0 || height === 0) {
      setSimNodes(prev => prev.length === 0 ? prev : []);
      return;
    }

    const centerX = width / 2;
    const centerY = height / 2;

    // --- Radial initial placement ---

    // Build adjacency from edges
    const adj = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adj.has(edge.source_id)) adj.set(edge.source_id, new Set());
      if (!adj.has(edge.target_id)) adj.set(edge.target_id, new Set());
      adj.get(edge.source_id)!.add(edge.target_id);
      adj.get(edge.target_id)!.add(edge.source_id);
    }

    // Sort by connection count to find center node
    const sorted = [...nodes].sort((a, b) => {
      const ca = adj.get(a.id)?.size || 0;
      const cb = adj.get(b.id)?.size || 0;
      return cb - ca;
    });

    // BFS to assign rings
    const ringMap = new Map<string, number>();
    if (sorted.length > 0 && adj.size > 0) {
      const startId = sorted[0].id;
      ringMap.set(startId, 0);
      const queue = [startId];
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentRing = ringMap.get(current)!;
        const neighbors = adj.get(current);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!ringMap.has(neighbor)) {
              ringMap.set(neighbor, currentRing + 1);
              queue.push(neighbor);
            }
          }
        }
      }
    }

    // Unconnected nodes go to outer ring
    const maxRing = Math.max(0, ...ringMap.values());
    for (const node of sorted) {
      if (!ringMap.has(node.id)) {
        ringMap.set(node.id, maxRing + 1);
      }
    }
    const totalRings = Math.max(1, ...ringMap.values());

    // Group by ring
    const rings = new Map<number, CanvasNode[]>();
    for (const node of sorted) {
      const ring = ringMap.get(node.id)!;
      if (!rings.has(ring)) rings.set(ring, []);
      rings.get(ring)!.push(node);
    }

    // Position nodes radially
    const maxRadius = Math.min(width, height) * 0.35;
    const nodeSpacing = 90;

    const initialNodes: HierarchicalSimNode[] = [];

    for (const [ring, ringNodes] of rings) {
      if (ring === 0) {
        for (const node of ringNodes) {
          initialNodes.push({ id: node.id, canvasNode: node, x: centerX, y: centerY });
        }
        continue;
      }

      const minRadiusForSpacing = (ringNodes.length * nodeSpacing) / (2 * Math.PI);
      const proportionalRadius = (ring / totalRings) * maxRadius;
      const radius = Math.max(proportionalRadius, minRadiusForSpacing);

      const angleStep = (2 * Math.PI) / ringNodes.length;
      const angleOffset = ring * 0.4;

      for (let i = 0; i < ringNodes.length; i++) {
        const angle = angleOffset + i * angleStep;
        initialNodes.push({
          id: ringNodes[i].id,
          canvasNode: ringNodes[i],
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }
    }

    // --- Light force sim to resolve overlaps while preserving radial structure ---

    const links: SimLink[] = edges.map((edge) => ({
      source: edge.source_id,
      target: edge.target_id,
      strength: edge.weight * 0.15,
    }));

    const getRadius = (d: HierarchicalSimNode) => {
      switch (d.canvasNode.node_type) {
        case 'category': return 75;
        case 'tag': return 65;
        case 'semantic_cluster': return 70;
        case 'atom': return 60;
        default: return 65;
      }
    };

    // Store target positions for radial pull-back
    const targetPositions = new Map<string, { x: number; y: number }>();
    for (const node of initialNodes) {
      targetPositions.set(node.id, { x: node.x, y: node.y });
    }

    // Custom radial pull-back force — pulls toward target angle+distance, not axis-aligned
    function radialPullBack(strength: number) {
      return () => {
        for (const node of initialNodes) {
          const target = targetPositions.get(node.id);
          if (!target) continue;
          const dx = target.x - node.x!;
          const dy = target.y - node.y!;
          node.vx = (node.vx || 0) + dx * strength;
          node.vy = (node.vy || 0) + dy * strength;
        }
      };
    }

    setIsSimulating(true);

    const simulation = d3
      .forceSimulation<HierarchicalSimNode>(initialNodes)
      // Collision is the main force — resolve overlaps
      .force('collide', d3.forceCollide<HierarchicalSimNode>().radius(getRadius).strength(0.8))
      // Weak links to maintain edge relationships
      .force(
        'link',
        d3.forceLink<HierarchicalSimNode, SimLink>(links)
          .id((d) => d.id)
          .strength((d) => d.strength)
      )
      // Pull toward radial target (angle-preserving, not axis-aligned)
      .force('radialPullBack', radialPullBack(0.3))
      // Low energy — just enough to resolve overlaps, not rearrange
      .alpha(0.5)
      .alphaDecay(0.08)
      .velocityDecay(0.5);

    let tickCount = 0;
    simulation.on('tick', () => {
      tickCount++;
      if (tickCount % 3 === 0) {
        setSimNodes([...initialNodes]);
      }
    });

    simulation.on('end', () => {
      setIsSimulating(false);
      setSimNodes([...initialNodes]);
    });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      simulationRef.current = null;
    };
  }, [nodes, edges, width, height]);

  return { simNodes, isSimulating };
}
