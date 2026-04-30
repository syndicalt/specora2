import {
  AlertTriangle,
  Clock,
  Database,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  GitCommitHorizontal,
  Link2,
  Map as MapIcon,
  Route,
  type LucideIcon,
} from "lucide-react";
import { MarkerType, type Edge, type Node } from "reactflow";
import { pct } from "./helpers";
import type { DiscoveryFlowNodeData, DiscoveryNodeKind, TransformProposal } from "./types";

export const NODE_CATALOG: Array<{
  kind: DiscoveryNodeKind;
  title: string;
  detail: string;
  color: string;
  icon: LucideIcon;
}> = [
  { kind: "schedule", title: "Trigger / Schedule", detail: "Run manually, interval-based, or integration-triggered", color: "#94a3b8", icon: Clock },
  { kind: "source", title: "Source", detail: "Read rows from CSV, API, DB, or cloud inventory", color: "#38bdf8", icon: FileSpreadsheet },
  { kind: "profile", title: "Profile", detail: "Infer schema, keys, cardinality, and data quality", color: "#a78bfa", icon: FileCheck2 },
  { kind: "transform", title: "Transform", detail: "Normalize fields, map attributes, and enrich rows", color: "#6366f1", icon: MapIcon },
  { kind: "router", title: "Class Router", detail: "Route records to CI classes with rules or AI rationale", color: "#f59e0b", icon: Route },
  { kind: "validator", title: "Validate", detail: "Block bad rows before they reach staging", color: "#fb7185", icon: AlertTriangle },
  { kind: "linker", title: "Linker", detail: "Create CSDM relationships and dependency edges", color: "#14b8a6", icon: Link2 },
  { kind: "reconcile", title: "Reconcile", detail: "Match existing CIs and decide create/update strategy", color: "#eab308", icon: GitCommitHorizontal },
  { kind: "stage", title: "Stage", detail: "Preview safe changes before commit", color: "#22c55e", icon: Eye },
  { kind: "target", title: "Target", detail: "Commit into CMDB classes and relationship types", color: "#10b981", icon: Database },
];

export function catalogFor(kind: DiscoveryNodeKind) {
  return NODE_CATALOG.find((item) => item.kind === kind) || NODE_CATALOG[0];
}

export function node(
  id: string,
  label: string,
  detail: string,
  x: number,
  y: number,
  color = "#6366f1",
  kind: DiscoveryNodeKind = "transform",
  metric?: string
): Node<DiscoveryFlowNodeData> {
  return {
    id,
    type: "discoveryNode",
    position: { x, y },
    data: { kind, title: label, detail, color, metric, status: metric ? "ready" : "idle" },
    style: {
      width: 190,
      minHeight: 72,
      borderRadius: 8,
      border: `1px solid ${color}`,
      background: "#111827",
      color: "#f3f4f6",
      fontSize: 12,
      whiteSpace: "pre-line",
      boxShadow: "0 12px 36px rgba(0,0,0,.22)",
    },
  };
}

export function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
    animated: true,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#818cf8" },
  };
}

function sideBetween(source: Node, target: Node): "top" | "right" | "bottom" | "left" {
  const dx = target.position.x - source.position.x;
  const dy = target.position.y - source.position.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function oppositeSide(side: "top" | "right" | "bottom" | "left") {
  if (side === "top") return "bottom";
  if (side === "bottom") return "top";
  if (side === "left") return "right";
  return "left";
}

export function withDynamicEdgeHandles(edges: Edge[], nodes: Node[]): Edge[] {
  const byId = new Map(nodes.map((item) => [item.id, item]));
  return edges.map((item) => {
    const source = byId.get(item.source);
    const target = byId.get(item.target);
    if (!source || !target) return item;
    const sourceHandle = sideBetween(source, target);
    return {
      ...item,
      sourceHandle,
      targetHandle: oppositeSide(sourceHandle),
    };
  });
}

export function proposalToFlow(proposal: TransformProposal | null, sourceName: string): { nodes: Node[]; edges: Edge[] } {
  if (!proposal) {
    return {
      nodes: [
        node("source", "1. Source", sourceName || "Paste or upload sample data", 20, 120, "#38bdf8"),
        node("profile", "2. Profile", "Detect columns, quality, keys", 260, 120, "#a78bfa", "profile"),
        node("ai", "3. AI Draft", "Generate mappings and routes", 500, 120, "#f59e0b", "transform"),
        node("stage", "4. Stage", "Preview create/update/link", 740, 120, "#22c55e", "stage"),
      ],
      edges: [edge("e1", "source", "profile"), edge("e2", "profile", "ai"), edge("e3", "ai", "stage")],
    };
  }

  const nodes: Node[] = [
    node("source", "Source", sourceName, 20, 140, "#38bdf8", "source", `${proposal.classRoutes.length} routes`),
    node("profile", "Profile", `${proposal.fieldMappings.length} mapped fields`, 250, 140, "#a78bfa", "profile", `${proposal.fieldMappings.length} fields`),
    node("classify", "Class Router", proposal.classRoutes.map((r) => r.targetClass).join(", "), 480, 60, "#f59e0b", "router", pct(Math.max(...proposal.classRoutes.map((r) => r.confidence), proposal.confidence))),
    node("map", "Transform", `${proposal.fieldMappings.length} field rules`, 480, 220, "#6366f1", "transform", `${proposal.fieldMappings.length} rules`),
    node("link", "Linker", `${proposal.relationshipRules.length} relationship rules`, 710, 60, "#14b8a6", "linker", `${proposal.relationshipRules.length} links`),
    node("reconcile", "Reconcile", proposal.reconciliationRules.map((r) => r.matchKeys.join("+")).join(", "), 710, 220, "#eab308", "reconcile", `${proposal.reconciliationRules.length} keys`),
    node("stage", "Stage", `Confidence ${pct(proposal.confidence)}`, 940, 140, "#22c55e", "stage", pct(proposal.confidence)),
  ];

  return {
    nodes,
    edges: [
      edge("e-source-profile", "source", "profile"),
      edge("e-profile-classify", "profile", "classify"),
      edge("e-profile-map", "profile", "map"),
      edge("e-classify-link", "classify", "link"),
      edge("e-map-reconcile", "map", "reconcile"),
      edge("e-link-stage", "link", "stage"),
      edge("e-reconcile-stage", "reconcile", "stage"),
    ],
  };
}

export function keepPositions(nextNodes: Node[], currentNodes: Node[]) {
  const positions = new Map(currentNodes.map((item) => [item.id, item.position]));
  return nextNodes.map((item) => positions.has(item.id) ? { ...item, position: positions.get(item.id)! } : item);
}

