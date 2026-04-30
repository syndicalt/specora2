import { AlertTriangle, ArrowUpRight, RefreshCw } from "lucide-react";
import { SELECT_CLASS } from "./constants";
import { formatDateTime } from "./helpers";
import { MetricPill } from "./MetricPill";
import type { CleanupReview } from "./types";

export function CleanupReviewWorkbench({
  reviews,
  status,
  loading,
  busy,
  onStatusChange,
  onRefresh,
  onOpenRecord,
  onUpdateStatus,
}: {
  reviews: CleanupReview[];
  status: CleanupReview["status"] | "all";
  loading: boolean;
  busy: boolean;
  onStatusChange: (status: CleanupReview["status"] | "all") => void;
  onRefresh: () => void;
  onOpenRecord: (review: CleanupReview) => void;
  onUpdateStatus: (review: CleanupReview, status: CleanupReview["status"]) => void;
}) {
  const active = reviews.filter((review) => review.status === "open" || review.status === "in_progress").length;
  const critical = reviews.filter((review) => review.severity === "critical").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-gray-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-800 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Stewardship Queue</h2>
          <p className="text-xs text-gray-500">Review, route, and close cleanup work queued from Tables.</p>
        </div>
        <div className="ml-4 hidden items-center gap-2 lg:flex">
          <MetricPill label="Loaded" value={reviews.length} />
          <MetricPill label="Active" value={active} tone={active ? "warn" : "good"} />
          <MetricPill label="Critical" value={critical} tone={critical ? "warn" : "neutral"} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={status} onChange={(event) => onStatusChange(event.target.value as typeof status)} className={SELECT_CLASS}>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All</option>
          </select>
          <button onClick={onRefresh} className="rounded-lg border border-gray-700 bg-gray-900 p-2 text-gray-300 hover:text-white" title="Refresh queue">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>
      <div className="scrollbar-thin flex-1 overflow-y-auto p-5 pb-32">
        {loading ? (
          <div className="rounded-lg border border-dashed border-gray-800 px-4 py-10 text-center text-sm text-gray-500">Loading cleanup reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-800 px-4 py-10 text-center text-sm text-gray-500">No cleanup reviews match this view.</div>
        ) : (
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                <div className="flex items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${review.severity === "critical" || review.severity === "high" ? "bg-red-500/10 text-red-200" : review.severity === "medium" ? "bg-amber-500/10 text-amber-200" : "bg-gray-800 text-gray-300"}`}>
                        {review.severity}
                      </span>
                      <span className="rounded bg-gray-800 px-2 py-0.5 text-[10px] uppercase text-gray-400">{review.status.replace("_", " ")}</span>
                      <span className="font-mono text-[11px] text-gray-600">{review.tableId}</span>
                    </div>
                    <div className="mt-2 text-sm font-medium text-gray-100">{review.recordLabel}</div>
                    <div className="mt-1 text-sm text-gray-400">{review.reason}</div>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-600">
                      <span>{review.tableLabel}</span>
                      <span className="font-mono">{review.recordId}</span>
                      <span>{review.requesterName || review.requesterEmail || "system"}</span>
                      <span>{formatDateTime(review.updatedAt || review.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-2">
                    <button onClick={() => onOpenRecord(review)} className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:text-white">
                      <ArrowUpRight className="h-3.5 w-3.5" />
                      Open record
                    </button>
                    {review.status === "open" && (
                      <button disabled={busy} onClick={() => onUpdateStatus(review, "in_progress")} className="rounded-lg border border-indigo-500/30 px-3 py-1.5 text-xs text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50">
                        Start
                      </button>
                    )}
                    {review.status !== "resolved" && (
                      <button disabled={busy} onClick={() => onUpdateStatus(review, "resolved")} className="rounded-lg border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/10 disabled:opacity-50">
                        Resolve
                      </button>
                    )}
                    {review.status !== "dismissed" && (
                      <button disabled={busy} onClick={() => onUpdateStatus(review, "dismissed")} className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

