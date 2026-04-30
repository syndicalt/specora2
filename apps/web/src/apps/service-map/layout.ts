import type { Edge as FlowEdge, Node as FlowNode } from "reactflow";
import { MarkerType } from "reactflow";
import dagre from "dagre";
import type { NodeData } from "./ServiceMapNode";

export type APINode = {
  id: string;
  name: string;
  class: string;
  environment?: string;
  attributes?: Record<string, any>;
  health?: {
    overall: number;
    freshness: number;
    completeness: number;
    relationshipValidity: number;
  } | null;
  classDisplayName?: string;
};

export type APIEdge = { id: string; type: string; sourceId: string; targetId: string };

export type RelationshipTypeOption = {
  id: string;
  name: string;
  displayName: string;
  color: string;
  active: boolean;
  isSystem: boolean;
};

export const REL_COLORS: Record<string, { stroke: string; bg: string }> = {
  PART_OF: { stroke: "#a78bfa", bg: "#7c3aed" },
  DEPENDS_ON: { stroke: "#6366f1", bg: "#4338ca" },
  HOSTED_ON: { stroke: "#2dd4bf", bg: "#0d9488" },
  MANAGED_BY: { stroke: "#fbbf24", bg: "#d97706" },
  OWNED_BY: { stroke: "#34d399", bg: "#059669" },
  LOCATED_AT: { stroke: "#fb7185", bg: "#e11d48" },
};

export const REL_TYPES = ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"];

const NODE_WIDTH = 260;
const NODE_HEIGHT = 100;
const NODE_GAP = 48;

export function getRelColor(type: string, registeredColors: Record<string, string> = {}) {
  const registered = registeredColors[type];
  return registered ? { stroke: registered, bg: registered } : REL_COLORS[type] || REL_COLORS.DEPENDS_ON;
}

export function relLabel(type: string) {
  return type.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function computeLayout(nodes: APINode[], edges: APIEdge[], classDisplayNames: Record<string, string>, highlightId?: string | null, relationshipColors: Record<string, string> = {}) {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 90, ranksep: 160, edgesep: 40, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { label: node.name, width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  const seenEdges = new Set<string>();
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      g.setEdge(ed.sourceId, ed.targetId);
    }
  });

  dagre.layout(g);

  const relCountMap = new Map<string, number>();
  edges.forEach((ed) => {
    relCountMap.set(ed.sourceId, (relCountMap.get(ed.sourceId) || 0) + 1);
    relCountMap.set(ed.targetId, (relCountMap.get(ed.targetId) || 0) + 1);
  });

  const flowNodes: FlowNode[] = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const nodeData: NodeData = {
      id: node.id,
      name: node.name,
      class: node.class,
      classDisplayName: node.classDisplayName || classDisplayNames[node.class] || node.class,
      environment: node.environment,
      attributes: node.attributes,
      health: node.health,
      relationshipCount: relCountMap.get(node.id) || 0,
    };
    return {
      id: node.id,
      data: nodeData,
      position: { x: dagreNode.x - dagreNode.width / 2, y: dagreNode.y - dagreNode.height / 2 },
      style: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: "transparent",
        border: "none",
        borderRadius: "8px",
        padding: 0,
      },
      className: node.id === highlightId ? "node-highlight" : undefined,
    };
  });

  const flowEdges: FlowEdge[] = [];
  seenEdges.clear();
  edges.forEach((ed) => {
    const key = `${ed.sourceId}->${ed.targetId}`;
    if (!seenEdges.has(key)) {
      seenEdges.add(key);
      const color = getRelColor(ed.type, relationshipColors);
      flowEdges.push({
        id: ed.id, source: ed.sourceId, target: ed.targetId, label: relLabel(ed.type), type: "default",
        data: { relationshipType: ed.type },
        style: { stroke: color.stroke, strokeWidth: 2 },
        labelStyle: { fill: color.stroke, fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "#111827", fillOpacity: 0.95 },
        labelBgPadding: [4, 4], animated: ed.type === "DEPENDS_ON",
        markerEnd: { type: MarkerType.ArrowClosed, color: color.stroke },
      });
    }
  });

  return { nodes: flowNodes, edges: flowEdges };
}

function rectsOverlap(a: { x: number; y: number }, b: { x: number; y: number }) {
  return (
    a.x < b.x + NODE_WIDTH + NODE_GAP &&
    a.x + NODE_WIDTH + NODE_GAP > b.x &&
    a.y < b.y + NODE_HEIGHT + NODE_GAP &&
    a.y + NODE_HEIGHT + NODE_GAP > b.y
  );
}

function findOpenPosition(preferred: { x: number; y: number }, occupied: Array<{ x: number; y: number }>) {
  const stepX = NODE_WIDTH + NODE_GAP;
  const stepY = NODE_HEIGHT + NODE_GAP;
  const candidates: Array<{ x: number; y: number }> = [preferred];

  for (let ring = 1; ring <= 8; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      candidates.push({ x: preferred.x + dx * stepX, y: preferred.y - ring * stepY });
      candidates.push({ x: preferred.x + dx * stepX, y: preferred.y + ring * stepY });
    }
    for (let dy = -ring + 1; dy <= ring - 1; dy += 1) {
      candidates.push({ x: preferred.x - ring * stepX, y: preferred.y + dy * stepY });
      candidates.push({ x: preferred.x + ring * stepX, y: preferred.y + dy * stepY });
    }
  }

  return candidates.find((candidate) => occupied.every((pos) => !rectsOverlap(candidate, pos))) || preferred;
}

export function placeExpandedNodes(existingNodes: FlowNode[], sourceId: string, newItems: APINode[]) {
  const source = existingNodes.find((node) => node.id === sourceId);
  const sourcePosition = source?.position || { x: 100, y: 100 };
  const occupied = existingNodes.map((node) => node.position);
  const count = Math.max(newItems.length, 1);
  const radiusX = NODE_WIDTH + 140;
  const radiusY = NODE_HEIGHT + 110;

  return newItems.map((item, index) => {
    const angle = (-Math.PI / 2) + (index * 2 * Math.PI) / count;
    const preferred = {
      x: sourcePosition.x + Math.cos(angle) * radiusX,
      y: sourcePosition.y + Math.sin(angle) * radiusY,
    };
    const position = findOpenPosition(preferred, occupied);
    occupied.push(position);
    return { item, position };
  });
}
