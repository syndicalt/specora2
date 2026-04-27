import { useState, useEffect } from "react";
import type { ShellAPI } from "@/sdk/types";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

interface AuditEntry {
  id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: string | null;
  created_at?: string | null;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function AuditLogApp({ shell }: { shell: ShellAPI }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetchEntries();
  }, []);

  async function fetchEntries() {
    try {
      const res = await fetch(`${API_URL}/graphql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() || ""}`,
        },
        body: JSON.stringify({
          query: `
            query {
              auditLog(limit: 100) {
                id
                actorId
                action
                entityType
                entityId
                oldValues
                newValues
                createdAt
              }
            }
          `,
        }),
      });
      const data = await res.json();
      if (data.data?.auditLog) {
        setEntries(data.data.auditLog);
      }
    } catch (err) {
      console.error("Failed to fetch audit log:", err);
      shell.notify("Failed to fetch audit log", "error");
    } finally {
      setLoading(false);
    }
  }

  const filtered = filter
    ? entries.filter((e) => e.action.includes(filter) || e.entityType.includes(filter) || e.entityId.includes(filter))
    : entries;

  const actionColors: Record<string, string> = {
    "ci.created": "bg-green-900/50 text-green-300",
    "ci.updated": "bg-yellow-900/50 text-yellow-300",
    "ci.deleted": "bg-red-900/50 text-red-300",
    "relationship.created": "bg-green-900/50 text-green-300",
    "relationship.updated": "bg-yellow-900/50 text-yellow-300",
    "relationship.deleted": "bg-red-900/50 text-red-300",
    "discovery.completed": "bg-blue-900/50 text-blue-300",
  };

  return (
    <div className="h-full w-full bg-gray-950 text-gray-100 flex flex-col">
      <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by action, type, or ID"
          className="px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </header>

      <div className="flex-1 overflow-auto p-6 pb-24">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-gray-500">No audit entries found.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="p-4 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                      actionColors[entry.action] || "bg-gray-800 text-gray-400"
                    }`}
                  >
                    {entry.action}
                  </span>
                  <span className="text-xs text-gray-500">{formatDateTime(entry.createdAt || entry.created_at)}</span>
                  {entry.actorId && <span className="text-xs text-gray-500">Actor: {entry.actorId}</span>}
                </div>
                <div className="text-sm text-gray-300 mb-2">
                  {entry.entityType} <span className="text-gray-500">{entry.entityId}</span>
                </div>
                {(entry.oldValues || entry.newValues) && (
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    {entry.oldValues && (
                      <div className="p-2 bg-red-950/30 rounded-lg border border-red-900/30">
                        <div className="text-red-400 font-medium mb-1">Before</div>
                        <pre className="text-gray-400 overflow-x-auto">{JSON.stringify(entry.oldValues, null, 2)}</pre>
                      </div>
                    )}
                    {entry.newValues && (
                      <div className="p-2 bg-green-950/30 rounded-lg border border-green-900/30">
                        <div className="text-green-400 font-medium mb-1">After</div>
                        <pre className="text-gray-400 overflow-x-auto">{JSON.stringify(entry.newValues, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
