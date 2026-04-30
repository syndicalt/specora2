import { useEffect, useRef, useState } from "react";
import { Calendar, Clock } from "lucide-react";
import { toolLabel, type PendingApproval, type ResultCard, type WorkStep } from "./ChatOverlay.helpers";

export function DatePickerWidget({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    dateRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) return;
    const formatted = time ? `${date}T${time}` : date;
    onSubmit(formatted);
  };

  return (
    <div className="mt-2 p-3 rounded-xl bg-gray-950 border border-gray-700/60 shadow-lg max-w-sm">
      <p className="text-xs text-gray-400 mb-2 font-medium">Pick a date and time</p>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          <input
            ref={dateRef}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
            required
          />
        </div>
        <div className="relative flex-1 min-w-0">
          <Clock className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          type="submit"
          disabled={!date}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors disabled:opacity-50 shrink-0"
        >
          Confirm
        </button>
      </form>
    </div>
  );
}

export function WorkingTrace({ steps }: { steps: WorkStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-2xl rounded-bl-md border border-gray-800 bg-gray-900/80 px-3 py-2 text-xs text-gray-400">
      <div className="mb-1.5 flex items-center gap-2 font-medium text-gray-300">
        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300" />
        Working steps
      </div>
      <div className="space-y-1">
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${step.status === "completed" ? "bg-emerald-300" : step.status === "error" ? "bg-red-300" : "bg-cyan-300"}`} />
            <span className={step.status === "active" ? "text-gray-200" : "text-gray-500"}>{step.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApprovalCard({
  approval,
  onApprove,
  onCancel,
}: {
  approval: PendingApproval;
  onApprove: (approval: PendingApproval) => void;
  onCancel: (id: string) => void;
}) {
  const visibleArgs = Object.entries(approval.arguments)
    .filter(([key]) => !key.startsWith("_"))
    .slice(0, 4);
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-amber-300">Approval Required</div>
          <div className="mt-1 font-medium text-amber-50">{toolLabel(approval.name)}</div>
        </div>
        <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[11px] font-semibold uppercase text-amber-200">{approval.risk} risk</span>
      </div>
      <p className="text-xs leading-5 text-amber-100/80">{approval.reason}</p>
      {visibleArgs.length > 0 && (
        <div className="mt-2 rounded-xl border border-amber-400/20 bg-gray-950/50 p-2">
          {visibleArgs.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="w-24 shrink-0 text-amber-300/70">{key}</span>
              <span className="min-w-0 truncate text-amber-50/90">{typeof value === "string" ? value : JSON.stringify(value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onCancel(approval.id)}
          className="rounded-lg border border-amber-400/20 px-3 py-1.5 text-xs text-amber-100/80 transition-colors hover:bg-amber-400/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApprove(approval)}
          className="rounded-lg bg-amber-300 px-3 py-1.5 text-xs font-medium text-gray-950 transition-colors hover:bg-amber-200"
        >
          Approve
        </button>
      </div>
    </div>
  );
}

export function ResultCardView({ card, onAction }: { card: ResultCard; onAction: (type: string, payload: string) => void }) {
  if (card.type === "ci") {
    const relationshipCount = card.ci.relationships?.length || 0;
    const incoming = card.ci.relationships?.filter((relationship) => relationship.direction === "incoming").length || 0;
    const outgoing = Math.max(relationshipCount - incoming, 0);
    return (
      <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/10 p-3 text-sm text-cyan-50">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{card.ci.name}</div>
            <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-cyan-100/70">
              {card.ci.class && <span>{card.ci.class}</span>}
              {card.ci.environment && <span>{card.ci.environment}</span>}
              <span>{relationshipCount} relationships</span>
            </div>
          </div>
          <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-[11px] font-semibold uppercase text-cyan-100">CI</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-cyan-400/20 bg-gray-950/40 p-2">
            <div className="text-cyan-100/50">Upstream</div>
            <div className="mt-1 text-lg font-semibold text-cyan-50">{incoming}</div>
          </div>
          <div className="rounded-xl border border-cyan-400/20 bg-gray-950/40 p-2">
            <div className="text-cyan-100/50">Downstream</div>
            <div className="mt-1 text-lg font-semibold text-cyan-50">{outgoing}</div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => onAction("open-ci-details", `id=${card.ci.id}`)} className="rounded-lg bg-cyan-300 px-3 py-1.5 text-xs font-medium text-gray-950 hover:bg-cyan-200">
            Open CI
          </button>
          <button type="button" onClick={() => onAction("open-service-map", `rootId=${card.ci.id}`)} className="rounded-lg border border-cyan-400/30 px-3 py-1.5 text-xs text-cyan-100 hover:bg-cyan-400/10">
            Service Map
          </button>
        </div>
      </div>
    );
  }

  const root = card.nodes.find((node) => node.id === card.rootId);
  const classes = Array.from(new Set(card.nodes.map((node) => node.class).filter(Boolean))).slice(0, 3);
  return (
    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-50">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold">{root?.name || card.rootId}</div>
          <div className="mt-0.5 truncate text-xs text-emerald-100/70">{classes.length ? classes.join(" | ") : "Service map"}</div>
        </div>
        <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[11px] font-semibold uppercase text-emerald-100">Map</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-emerald-400/20 bg-gray-950/40 p-2">
          <div className="text-emerald-100/50">Nodes</div>
          <div className="mt-1 text-lg font-semibold text-emerald-50">{card.nodes.length}</div>
        </div>
        <div className="rounded-xl border border-emerald-400/20 bg-gray-950/40 p-2">
          <div className="text-emerald-100/50">Relationships</div>
          <div className="mt-1 text-lg font-semibold text-emerald-50">{card.edges.length}</div>
        </div>
      </div>
      <div className="mt-3">
        <button type="button" onClick={() => onAction("open-service-map", `rootId=${card.rootId}`)} className="rounded-lg bg-emerald-300 px-3 py-1.5 text-xs font-medium text-gray-950 hover:bg-emerald-200">
          Open Service Map
        </button>
      </div>
    </div>
  );
}
