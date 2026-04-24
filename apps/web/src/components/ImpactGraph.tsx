"use client";

import { useMemo } from "react";
import ReactFlow, { Background, Controls, Node as FlowNode, Edge as FlowEdge, MarkerType } from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";

export type ImpactNode = { id: string; name: string; class: string; role: "primary" | "affected" | "dependency" };
export type ImpactEdge = { sourceId: string; targetId: string; type: string };

const ROLE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  primary:   { bg: "#4338ca", border: "#6366f1", text: "#e0e7ff" },
  affected:  { bg: "#9a3412", border: "#f97316", text: "#ffedd5" },
  dependency:{ bg: "#047857", border: "#10b981", text: "#d1fae5" },
};

function computeLayout(nodes: ImpactNode[], edges: ImpactEdge[]) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 120, edgesep: 30 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeWidth = 200;
  const nodeHeight = 70;

  nodes.forEach((node) => {
    g.setNode(node.id, { label: node.name, width: nodeWidth, height: nodeHeight });
  });

  const seen = new Set<string>();
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seen.has(key)) {
      seen.add(key);
      g.setEdge(ed.sourceId, ed.targetId);
    }
  });

  dagre.layout(g);

  const flowNodes: FlowNode[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const colors = ROLE_COLORS[node.role] || ROLE_COLORS.dependency;
    return {
      id: node.id,
      data: { label: `${node.name}\n(${node.class})`, role: node.role },
      position: { x: dagreNode.x - dagreNode.width / 2, y: dagreNode.y - dagreNode.height / 2 },
      style: {
        background: colors.bg,
        color: colors.text,
        border: `2px solid ${colors.border}`,
        borderRadius: "8px",
        padding: "10px",
        fontSize: "12px",
        width: nodeWidth,
        textAlign: "center",
        whiteSpace: "pre-line",
      },
    };
  });

  const flowEdges: FlowEdge[] = edges.map((ed, i) => ({
    id: `e${i}`,
    source: ed.sourceId,
    target: ed.targetId,
    label: ed.type,
    labelStyle: { fill: "#9ca3af", fontSize: 10 },
    style: { stroke: "#4b5563", strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#4b5563" },
  }));

  return { flowNodes, flowEdges };
}

interface ImpactGraphProps {
  nodes: ImpactNode[];
  edges: ImpactEdge[];
  height?: number;
}

export function ImpactGraph({ nodes, edges, height = 300 }: ImpactGraphProps) {
  const { flowNodes, flowEdges } = useMemo(() => computeLayout(nodes, edges), [nodes, edges]);

  return (
    <div style={{ height }} className="w-full bg-gray-950 rounded-lg border border-gray-800">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        attributionPosition="bottom-left"
        nodesDraggable={false}
        nodesConnectable={false}
        zoomOnDoubleClick={false}
      >
        <Background color="#374151" gap={16} />
        <Controls />
      </ReactFlow>
      <div className="flex items-center gap-4 px-3 py-1.5 text-xs text-gray-400 border-t border-gray-800">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Primary</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500" /> Affected</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Dependency</span>
      </div>
    </div>
  );
}
