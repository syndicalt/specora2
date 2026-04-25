"use client";

import { Handle, Position } from "reactflow";
import { Activity, Server, Database, Globe, Layers, Users, Cpu, MapPin, Radio, Shield } from "lucide-react";

export interface NodeData {
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
  relationshipCount?: number;
  decorators?: Array<{
    id: string;
    type: "rfc" | "incident" | "alert";
    count: number;
    severity: "low" | "medium" | "high" | "critical";
  }>;
}

export const CLASS_STYLES: Record<string, {
  border: string;
  bg: string;
  badgeBg: string;
  badgeText: string;
  icon: React.ElementType;
}> = {
  BusinessService: {
    border: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.08)",
    badgeBg: "rgba(245, 158, 11, 0.2)",
    badgeText: "#fbbf24",
    icon: Globe,
  },
  ApplicationService: {
    border: "#6366f1",
    bg: "rgba(99, 102, 241, 0.08)",
    badgeBg: "rgba(99, 102, 241, 0.2)",
    badgeText: "#a5b4fc",
    icon: Layers,
  },
  Application: {
    border: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.08)",
    badgeBg: "rgba(139, 92, 246, 0.2)",
    badgeText: "#c4b5fd",
    icon: Cpu,
  },
  Database: {
    border: "#14b8a6",
    bg: "rgba(20, 184, 166, 0.08)",
    badgeBg: "rgba(20, 184, 166, 0.2)",
    badgeText: "#5eead4",
    icon: Database,
  },
  Server: {
    border: "#22c55e",
    bg: "rgba(34, 197, 94, 0.08)",
    badgeBg: "rgba(34, 197, 94, 0.2)",
    badgeText: "#86efac",
    icon: Server,
  },
  TechnicalService: {
    border: "#0ea5e9",
    bg: "rgba(14, 165, 233, 0.08)",
    badgeBg: "rgba(14, 165, 233, 0.2)",
    badgeText: "#7dd3fc",
    icon: Radio,
  },
  User: {
    border: "#ec4899",
    bg: "rgba(236, 72, 153, 0.08)",
    badgeBg: "rgba(236, 72, 153, 0.2)",
    badgeText: "#f9a8d4",
    icon: Users,
  },
  Group: {
    border: "#6b7280",
    bg: "rgba(107, 114, 128, 0.08)",
    badgeBg: "rgba(107, 114, 128, 0.2)",
    badgeText: "#d1d5db",
    icon: Shield,
  },
  NetworkGear: {
    border: "#f97316",
    bg: "rgba(249, 115, 22, 0.08)",
    badgeBg: "rgba(249, 115, 22, 0.2)",
    badgeText: "#fdba74",
    icon: Activity,
  },
  Location: {
    border: "#84cc16",
    bg: "rgba(132, 204, 22, 0.08)",
    badgeBg: "rgba(132, 204, 22, 0.2)",
    badgeText: "#bef264",
    icon: MapPin,
  },
};

function getClassStyle(className: string) {
  return CLASS_STYLES[className] || CLASS_STYLES.Group;
}

function getHealthColor(score: number): { color: string; bg: string; label: string } {
  if (score >= 0.85) return { color: "#22c55e", bg: "rgba(34, 197, 94, 0.15)", label: "Healthy" };
  if (score >= 0.6) return { color: "#eab308", bg: "rgba(234, 179, 8, 0.15)", label: "Fair" };
  if (score >= 0.4) return { color: "#f97316", bg: "rgba(249, 115, 22, 0.15)", label: "Degraded" };
  return { color: "#ef4444", bg: "rgba(239, 68, 68, 0.15)", label: "Critical" };
}

function getEnvironmentStyle(env: string): { bg: string; text: string; label: string } {
  const e = env.toLowerCase();
  if (e.includes("prod")) return { bg: "rgba(34, 197, 94, 0.15)", text: "#86efac", label: "PROD" };
  if (e.includes("stag")) return { bg: "rgba(234, 179, 8, 0.15)", text: "#fde047", label: "STG" };
  if (e.includes("dev")) return { bg: "rgba(59, 130, 246, 0.15)", text: "#93c5fd", label: "DEV" };
  if (e.includes("decom")) return { bg: "rgba(107, 114, 128, 0.15)", text: "#d1d5db", label: "DECOM" };
  return { bg: "rgba(99, 102, 241, 0.15)", text: "#c7d2fe", label: env };
}

export function ServiceMapNode({ data }: { data: NodeData }) {
  const style = getClassStyle(data.class);
  const Icon = style.icon;
  const health = data.health;
  const healthInfo = health ? getHealthColor(health.overall) : null;
  const env = data.environment ? getEnvironmentStyle(data.environment) : null;

  return (
    <div
      className="relative w-full h-full rounded-lg overflow-hidden"
      style={{
        background: "#1f2937",
        border: `1px solid ${style.border}40`,
        borderTop: `3px solid ${style.border}`,
        boxShadow: `0 0 0 1px ${style.border}15, 0 4px 12px rgba(0,0,0,0.3)`,
      }}
    >
      {/* Class tint background */}
      <div
        className="absolute inset-0 opacity-30"
        style={{ background: style.bg }}
      />

      {/* Handles on all 4 sides, positioned at actual borders */}
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: style.border,
          width: 10,
          height: 10,
          border: "2px solid #1f2937",
          top: -5,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: style.border,
          width: 10,
          height: 10,
          border: "2px solid #1f2937",
          bottom: -5,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: style.border,
          width: 10,
          height: 10,
          border: "2px solid #1f2937",
          left: -5,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: style.border,
          width: 10,
          height: 10,
          border: "2px solid #1f2937",
          right: -5,
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col h-full p-2.5">
        {/* Top row: Icon + Name + Environment badge */}
        <div className="flex items-start gap-2 min-w-0">
          <div
            className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center mt-0.5"
            style={{ background: style.badgeBg }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: style.badgeText }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-100 leading-tight truncate">
              {data.name}
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5 leading-tight">
              {data.class}
            </div>
          </div>
          {env && (
            <div
              className="flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider"
              style={{ background: env.bg, color: env.text }}
            >
              {env.label}
            </div>
          )}
        </div>

        {/* Bottom row: Health + Relationship count + Decorators */}
        <div className="flex items-center justify-between mt-auto pt-1.5">
          <div className="flex items-center gap-1.5">
            {healthInfo && (
              <div className="flex items-center gap-1" title={`Health: ${healthInfo.label} (${Math.round((health?.overall || 0) * 100)}%)`}>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: healthInfo.color,
                    boxShadow: `0 0 4px ${healthInfo.color}60`,
                  }}
                />
                <span className="text-[10px] font-medium" style={{ color: healthInfo.color }}>
                  {Math.round((health?.overall || 0) * 100)}%
                </span>
              </div>
            )}
            {typeof data.relationshipCount === "number" && data.relationshipCount > 0 && (
              <div className="flex items-center gap-0.5 text-gray-500">
                <span className="text-[10px]">×{data.relationshipCount}</span>
              </div>
            )}
          </div>

          {/* Plugin decorators */}
          {data.decorators && data.decorators.length > 0 && (
            <div className="flex items-center gap-1">
              {data.decorators.map((dec) => (
                <div
                  key={dec.id}
                  className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold"
                  style={{
                    background:
                      dec.severity === "critical"
                        ? "rgba(239, 68, 68, 0.2)"
                        : dec.severity === "high"
                        ? "rgba(249, 115, 22, 0.2)"
                        : dec.severity === "medium"
                        ? "rgba(234, 179, 8, 0.2)"
                        : "rgba(59, 130, 246, 0.2)",
                    color:
                      dec.severity === "critical"
                        ? "#fca5a5"
                        : dec.severity === "high"
                        ? "#fdba74"
                        : dec.severity === "medium"
                        ? "#fde047"
                        : "#93c5fd",
                  }}
                >
                  {dec.type === "rfc" && "⚡"}
                  {dec.type === "incident" && "🔥"}
                  {dec.type === "alert" && "🔔"}
                  {dec.count}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stale data indicator - dotted border overlay */}
      {data.health && data.health.freshness < 0.5 && (
        <div
          className="absolute inset-0 rounded-lg pointer-events-none"
          style={{
            border: `1px dashed ${style.border}50`,
          }}
        />
      )}
    </div>
  );
}
