"use client";

import { useMemo, useState } from "react";
import { Copy, Edit3, ExternalLink, GitBranch, LocateFixed, Network, X } from "lucide-react";
import { REL_COLORS } from "./index";
import { CLASS_STYLES } from "./ServiceMapNode";
import { useClassDisplayNames, type ClassAttributeDisplay } from "@/hooks/useClassDisplayNames";

type InspectorCI = {
  id: string;
  name: string;
  class: string;
  classDisplayName?: string;
  environment?: string;
  attributes?: Record<string, any>;
  health?: {
    overall: number;
    freshness: number;
    completeness: number;
    relationshipValidity: number;
  } | null;
  relationships?: {
    id: string;
    type: string;
    target: { id: string; name: string; class: string; classDisplayName?: string };
  }[];
};

interface SidebarPanelProps {
  ci: InspectorCI | null;
  classDisplayNames?: Record<string, string>;
  onClose: () => void;
  onEdit: (ci: InspectorCI) => void;
  onSetRoot: (id: string) => void;
  onExpand: (id: string) => void;
  onOpenRelated: (id: string) => void;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function healthMeta(score?: number) {
  if (score === undefined || score === null) return { label: "Unknown", text: "text-gray-400", bg: "bg-gray-800" };
  if (score >= 0.85) return { label: "Healthy", text: "text-emerald-300", bg: "bg-emerald-500/15" };
  if (score >= 0.6) return { label: "Fair", text: "text-yellow-300", bg: "bg-yellow-500/15" };
  if (score >= 0.4) return { label: "Degraded", text: "text-orange-300", bg: "bg-orange-500/15" };
  return { label: "Critical", text: "text-red-300", bg: "bg-red-500/15" };
}

function AttributeRows({ title, rows }: { title: string; rows: Array<[string, unknown, ClassAttributeDisplay | undefined]> }) {
  if (rows.length === 0) return null;

  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">{title}</h4>
      <div className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-gray-950/40">
        {rows.map(([key, value, def]) => (
          <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate text-gray-400">{def?.displayName || key}</div>
              {def?.displayName && <div className="truncate font-mono text-[10px] text-gray-600">{key}</div>}
            </div>
            <div className="min-w-0 truncate text-right text-gray-200" title={formatValue(value)}>
              {formatValue(value)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SidebarPanel({ ci, classDisplayNames = {}, onClose, onEdit, onSetRoot, onExpand, onOpenRelated }: SidebarPanelProps) {
  const [copied, setCopied] = useState(false);
  const { attributes, classDisplayName } = useClassDisplayNames(ci?.class);

  const groupedAttributes = useMemo(() => {
    const attrs = ci?.attributes || {};
    const defsByName = new Map(attributes.map((attr) => [attr.name, attr]));
    const entries = Object.entries(attrs).map(([key, value]) => [key, value, defsByName.get(key)] as [string, unknown, ClassAttributeDisplay | undefined]);
    const keyRows = entries.filter(([, , def]) => def?.isMandatory || def?.isKeyAttribute);
    const healthRows = entries.filter(([, , def]) => def?.isHealthRequired && !def?.isMandatory && !def?.isKeyAttribute);
    const keyNames = new Set([...keyRows, ...healthRows].map(([key]) => key));
    const otherRows = entries.filter(([key]) => !keyNames.has(key));
    return { keyRows, healthRows, otherRows };
  }, [attributes, ci?.attributes]);

  if (!ci) return null;

  const style = CLASS_STYLES[ci.class] || CLASS_STYLES.Group;
  const Icon = style.icon;
  const displayClass = classDisplayName || ci.classDisplayName || classDisplayNames[ci.class] || ci.class;
  const health = healthMeta(ci.health?.overall);

  const copyId = async () => {
    await navigator.clipboard?.writeText(ci.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <aside className="absolute right-0 top-0 z-30 flex h-full w-[380px] flex-col border-l border-gray-800 bg-gray-950 shadow-2xl">
      <header className="shrink-0 border-b border-gray-800 bg-gray-950 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ background: style.badgeBg }}>
            <Icon className="h-5 w-5" style={{ color: style.badgeText }} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-gray-100" title={ci.name}>{ci.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md px-2 py-0.5 text-xs" style={{ color: style.badgeText, background: style.badgeBg }}>
                {displayClass}
              </span>
              {ci.environment && <span className="rounded-md bg-gray-800 px-2 py-0.5 text-xs text-gray-300">{ci.environment}</span>}
              <span className={`rounded-md px-2 py-0.5 text-xs ${health.bg} ${health.text}`}>
                {health.label}{ci.health ? ` ${Math.round(ci.health.overall * 100)}%` : ""}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-gray-500 hover:bg-gray-800 hover:text-gray-200" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <button onClick={() => onEdit(ci)} className="flex flex-col items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white">
            <Edit3 className="h-4 w-4" />
            Edit
          </button>
          <button onClick={() => onSetRoot(ci.id)} className="flex flex-col items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white">
            <LocateFixed className="h-4 w-4" />
            Root
          </button>
          <button onClick={() => onExpand(ci.id)} className="flex flex-col items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white">
            <GitBranch className="h-4 w-4" />
            Expand
          </button>
          <button onClick={copyId} className="flex flex-col items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 px-2 py-2 text-xs text-gray-300 hover:border-indigo-500/50 hover:text-white">
            <Copy className="h-4 w-4" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="space-y-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Identity</h4>
          <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-950/40 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">CI ID</span>
              <span className="truncate font-mono text-xs text-gray-300" title={ci.id}>{ci.id}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Class name</span>
              <span className="truncate font-mono text-xs text-gray-300">{ci.class}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500">Relationships</span>
              <span className="text-gray-300">{ci.relationships?.length || 0}</span>
            </div>
          </div>
        </section>

        <AttributeRows title="Key Attributes" rows={groupedAttributes.keyRows} />
        <AttributeRows title="Operational Attributes" rows={groupedAttributes.healthRows} />
        <AttributeRows title="Other Attributes" rows={groupedAttributes.otherRows} />

        {(!ci.attributes || Object.keys(ci.attributes).length === 0) && (
          <div className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
            No attributes are recorded for this CI.
          </div>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Relationships</h4>
            <span className="text-xs text-gray-600">{ci.relationships?.length || 0}</span>
          </div>
          {ci.relationships && ci.relationships.length > 0 ? (
            <div className="space-y-2">
              {ci.relationships.map((rel) => {
                const color = REL_COLORS[rel.type] || REL_COLORS.DEPENDS_ON;
                const targetClass = rel.target.classDisplayName || classDisplayNames[rel.target.class] || rel.target.class;
                return (
                  <button
                    key={rel.id}
                    onClick={() => onOpenRelated(rel.target.id)}
                    className="w-full rounded-lg border border-gray-800 bg-gray-900/70 px-3 py-2 text-left hover:border-gray-700 hover:bg-gray-900"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color.stroke }} />
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color: color.stroke, backgroundColor: `${color.stroke}20` }}>
                        {rel.type}
                      </span>
                      <ExternalLink className="ml-auto h-3.5 w-3.5 text-gray-600" />
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-gray-200">{rel.target.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
                      <Network className="h-3 w-3" />
                      {targetClass}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-800 px-3 py-6 text-center text-sm text-gray-500">
              No relationships found.
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
