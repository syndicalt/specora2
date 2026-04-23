"use client";

import { useEffect, useState, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { graphqlClient } from "@/lib/api";

type APINode = { id: string; name: string; class: string };
type APIEdge = { id: string; type: string; sourceId: string; targetId: string };

function computeLayout(nodes: APINode[], edges: APIEdge[]) {
  // Build adjacency map
  const childrenMap = new Map<string, string[]>();
  const parentMap = new Map<string, string>();
  
  edges.forEach((e) => {
    if (!childrenMap.has(e.sourceId)) childrenMap.set(e.sourceId, []);
    childrenMap.get(e.sourceId)!.push(e.targetId);
    parentMap.set(e.targetId, e.sourceId);
  });

  // Find root (node with no parent)
  const rootId = nodes.find((n) => !parentMap.has(n.id))?.id || nodes[0]?.id;

  // Compute levels via BFS
  const levels = new Map<string, number>();
  const queue: string[] = [rootId];
  levels.set(rootId, 0);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLevel = levels.get(current)!;
    const children = childrenMap.get(current) || [];
    children.forEach((childId) => {
      if (!levels.has(childId)) {
        levels.set(childId, currentLevel + 1);
        queue.push(childId);
      }
    });
  }

  // Group nodes by level
  const levelGroups = new Map<number, string[]>();
  levels.forEach((level, id) => {
    if (!levelGroups.has(level)) levelGroups.set(level, []);
    levelGroups.get(level)!.push(id);
  });

  // Position nodes
  const nodeWidth = 220;
  const nodeHeight = 80;
  const levelGap = 180;
  const nodeGap = 40;

  const positions = new Map<string, { x: number; y: number }>();
  
  levelGroups.forEach((nodeIds, level) => {
    const totalWidth = nodeIds.length * nodeWidth + (nodeIds.length - 1) * nodeGap;
    const startX = -totalWidth / 2 + nodeWidth / 2;
    
    nodeIds.forEach((id, index) => {
      positions.set(id, {
        x: startX + index * (nodeWidth + nodeGap),
        y: level * levelGap,
      });
    });
  });

  // Handle nodes not in tree (disconnected)
  let orphanIndex = 0;
  nodes.forEach((node) => {
    if (!positions.has(node.id)) {
      positions.set(node.id, {
        x: (orphanIndex % 3) * (nodeWidth + nodeGap) - 300,
        y: Math.floor(orphanIndex / 3) * (nodeHeight + nodeGap) - 200,
      });
      orphanIndex++;
    }
  });

  const flowNodes: Node[] = nodes.map((node) => ({
    id: node.id,
    data: { label: `${node.name}\n(${node.class})` },
    position: positions.get(node.id) || { x: 0, y: 0 },
    style: {
      background: "#1f2937",
      color: "#f3f4f6",
      border: "1px solid #374151",
      borderRadius: "8px",
      padding: "12px",
      fontSize: "13px",
      width: nodeWidth,
      textAlign: "center",
      whiteSpace: "pre-line",
    },
  }));

  // Deduplicate edges
  const seenEdges = new Set<string>();
  const flowEdges: Edge[] = [];
  
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      flowEdges.push({
        id: ed.id,
        source: ed.sourceId,
        target: ed.targetId,
        label: ed.type,
        type: "smoothstep",
        style: { stroke: "#6366f1", strokeWidth: 2 },
        labelStyle: { fill: "#9ca3af", fontSize: 11 },
        labelBgStyle: { fill: "#111827", fillOpacity: 0.9 },
        labelBgPadding: [4, 4],
        animated: ed.type === "DEPENDS_ON",
      });
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export function GraphExplorer() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const data = await graphqlClient.request(`
        query {
          serviceMap(rootId: "bs-1") {
            nodes { id name class }
            edges { id type sourceId targetId }
          }
        }
      `);
      const map = (data as any).serviceMap;
      const layout = computeLayout(map.nodes, map.edges);
      setNodes(layout.nodes);
      setEdges(layout.edges);
    } catch (err) {
      console.error("Failed to load graph", err);
    } finally {
      setLoading(false);
    }
  }, [setNodes, setEdges]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-400">
        Loading service map...
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background color="#374151" gap={16} />
        <Controls
          position="top-right"
          className="!bg-transparent !border-none !shadow-none"
          showInteractive={false}
        />
      </ReactFlow>
    </div>
  );
}
