"use client";

import { RefreshCw } from "lucide-react";

export function BootstrapLoading({
  label,
  detail,
  timedOut = false,
  onRetry,
}: {
  label: string;
  detail?: string;
  timedOut?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-950 px-6 text-sm text-gray-500">
      <div className="max-w-md rounded-lg border border-gray-800 bg-gray-900/60 p-5 text-center shadow-2xl">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-300">
          <RefreshCw className={`h-4 w-4 ${timedOut ? "" : "animate-spin"}`} />
        </div>
        <div className="font-medium text-gray-200">{timedOut ? "Specora is taking longer than expected" : label}</div>
        {detail && <div className="mt-1 text-xs text-gray-500">{detail}</div>}
        {timedOut && (
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={onRetry || (() => window.location.reload())}
              className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 hover:border-indigo-500 hover:text-white"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
