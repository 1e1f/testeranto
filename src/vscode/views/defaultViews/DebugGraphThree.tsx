import React, { useEffect, useMemo, useRef } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import type { GraphData } from '../../../graph';
import { convertGraphData } from './DebugGraphUtils';
import type { DebugGraphConfig } from './DebugGraphView';

export function genRandomTree(N = 300, reverse = false) {
  return {
    nodes: [...Array(N).keys()].map(i => ({ id: i })),
    links: [...Array(N).keys()]
      .filter(id => id)
      .map(id => ({
        [reverse ? 'target' : 'source']: id,
        [reverse ? 'source' : 'target']: Math.round(Math.random() * (id - 1))
      }))
  };
}

interface DebugGraphThreeProps {
  data: GraphData | null;
  config: DebugGraphConfig;
  onNodeClick?: (node: any) => void;
  onNodeHover?: (node: any | null) => void;
  onEdgeClick?: (edge: any) => void;
  onEdgeHover?: (edge: any | null) => void;
}

export const DebugGraphThree: React.FC<DebugGraphThreeProps> = ({
  data,
  config,
  onNodeClick,
  onNodeHover,
  onEdgeClick,
  onEdgeHover
}) => {
  const graphRef = useRef<any>(null);
  const lastHoveredNodeIdRef = useRef<string | null>(null);
  const lastHoveredEdgeIdRef = useRef<string | null>(null);

  const convertedData = useMemo(() => convertGraphData(data, config), [data, config]);

  useEffect(() => {
    if (graphRef.current && convertedData.nodes && convertedData.nodes.length > 0) {
      graphRef.current.zoomToFit(400, 10);
    }
  }, [convertedData]);

  const handleNodeClick = (node: any) => {
    onNodeClick?.({ id: node.id, ...node });
  };

  const handleNodeHover = (node: any | null) => {
    const nodeId = node ? node.id : null;
    if (nodeId !== lastHoveredNodeIdRef.current) {
      lastHoveredNodeIdRef.current = nodeId;
      onNodeHover?.(node ? { id: node.id, ...node } : null);
    }
  };

  const handleLinkClick = (link: any) => {
    const edgeId = `${link.source.id}->${link.target.id}`;
    onEdgeClick?.({ id: edgeId, ...link });
  };

  const handleLinkHover = (link: any | null) => {
    const edgeId = link ? `${link.source.id}->${link.target.id}` : null;
    if (edgeId !== lastHoveredEdgeIdRef.current) {
      lastHoveredEdgeIdRef.current = edgeId;
      onEdgeHover?.(link ? { id: edgeId, ...link } : null);
    }
  };

  return (
    <div
      style={{
        flex: 2,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#1a1a2e'
      }}
    >
      <ForceGraph3D
        ref={graphRef}
        graphData={convertedData}
        nodeColor={(node: any) => node.color || config.nodeColor || '#4a90e2'}
        nodeVal={(node: any) => node.val || 1}
        nodeOpacity={0.8}
        linkColor={(link: any) => link.color || config.edgeColor || '#999'}
        linkOpacity={0.3}
        linkWidth={(link: any) => link.width || 0.5}
        onNodeClick={handleNodeClick}
        onNodeHover={handleNodeHover}
        onLinkClick={handleLinkClick}
        onLinkHover={handleLinkHover}
      />
    </div>
  );
};
