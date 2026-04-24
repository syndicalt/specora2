import { useState } from "react";
import type { ShellAPI } from "@/sdk/types";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

interface CoverageResult {
  gaps: string[];
  existing: Record<string, number>;
  suggestion: string;
}

export default function DiscoveryInsightsApp({ shell }: { shell: ShellAPI }) {
  const [environment, setEnvironment] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CoverageResult | null>(null);

  async function analyze() {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/apps/discovery-insights/tools/suggest_next_scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() || ""}` },
        body: JSON.stringify({ environment: environment || undefined }),
      });
      const data = await res.json();
      setResult(data);
    } catch (err) {
      console.error("Failed to analyze coverage:", err);
      shell.notify("Failed to analyze coverage", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full w-full bg-gray-950 text-gray-100 flex flex-col">
      <header className="px-6 py-4 border-b border-gray-800">
        <h1 className="text-xl font-semibold">Discovery Insights</h1>
        <p className="text-sm text-gray-500 mt-1">Analyze coverage gaps and plan your next scans.</p>
      </header>

      <div className="p-6 space-y-6 overflow-auto pb-24">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Environment (optional)</label>
            <input
              type="text"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              placeholder="e.g., Production, Staging"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={analyze}
            disabled={loading}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white transition-colors"
          >
            {loading ? "Analyzing..." : "Analyze Coverage"}
          </button>
        </div>

        {result && (
          <div className="space-y-4">
            <div className="p-4 bg-gray-900 rounded-xl border border-gray-800">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Current Coverage</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {Object.entries(result.existing).map(([cls, count]) => (
                  <div key={cls} className="p-3 bg-gray-800/50 rounded-lg">
                    <div className="text-lg font-semibold text-gray-200">{count}</div>
                    <div className="text-xs text-gray-500">{cls}</div>
                  </div>
                ))}
                {Object.keys(result.existing).length === 0 && (
                  <div className="text-sm text-gray-500 col-span-full">No CIs found.</div>
                )}
              </div>
            </div>

            {result.gaps.length > 0 && (
              <div className="p-4 bg-yellow-900/20 border border-yellow-800/50 rounded-xl">
                <h3 className="text-sm font-medium text-yellow-300 mb-2">Coverage Gaps Detected</h3>
                <div className="flex flex-wrap gap-2">
                  {result.gaps.map((gap) => (
                    <span key={gap} className="px-2.5 py-1 bg-yellow-900/40 text-yellow-300 rounded-full text-xs font-medium">
                      {gap}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-yellow-400/80 mt-3">{result.suggestion}</p>
              </div>
            )}

            {result.gaps.length === 0 && (
              <div className="p-4 bg-green-900/20 border border-green-800/50 rounded-xl">
                <p className="text-sm text-green-300">{result.suggestion}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
