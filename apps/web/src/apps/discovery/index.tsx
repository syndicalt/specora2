"use client";

import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "@/lib/api";
import { RefreshCw, Upload, Database, Clock, CheckCircle2, XCircle, AlertCircle, FileText } from "lucide-react";

interface DiscoverySource {
  id: string;
  name: string;
  type: string;
  config?: Record<string, any>;
  createdAt: string;
}

interface DiscoveryJob {
  id: string;
  sourceId: string | null;
  filePath: string | null;
  status: string;
  stats?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export default function DiscoveryDashboardApp() {
  const [sources, setSources] = useState<DiscoverySource[]>([]);
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"jobs" | "sources">("jobs");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sourcesData, jobsData] = await Promise.all([
        graphqlClient.request(`query { discoverySources { id name type config createdAt } }`),
        graphqlClient.request(`query { discoveryJobs { id sourceId filePath status stats createdAt updatedAt } }`),
      ]);
      setSources(((sourcesData as any).discoverySources || []) as DiscoverySource[]);
      setJobs(((jobsData as any).discoveryJobs || []) as DiscoveryJob[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case "completed":
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case "failed":
      case "error":
        return <XCircle className="w-4 h-4 text-red-400" />;
      case "running":
      case "in_progress":
        return <Clock className="w-4 h-4 text-yellow-400 animate-pulse" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <h2 className="font-semibold text-sm">Discovery Dashboard</h2>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={() => setActiveTab("jobs")}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            activeTab === "jobs" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
          }`}
        >
          <span className="flex items-center gap-2">
            <Upload className="w-4 h-4" />
            Jobs ({jobs.length})
          </span>
        </button>
        <button
          onClick={() => setActiveTab("sources")}
          className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
            activeTab === "sources" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
          }`}
        >
          <span className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Sources ({sources.length})
          </span>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading && activeTab === "jobs" && jobs.length === 0 ? (
          <div className="text-center text-gray-500 py-8 animate-pulse">Loading...</div>
        ) : activeTab === "jobs" ? (
          <div className="space-y-2">
            {jobs.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No discovery jobs yet</div>
            ) : (
              jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  {statusIcon(job.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-200">{job.status}</span>
                      <span className="text-xs text-gray-500">#{job.id.slice(0, 8)}</span>
                    </div>
                    {job.filePath && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                        <FileText className="w-3 h-3" />
                        <span className="truncate">{job.filePath}</span>
                      </div>
                    )}
                    {job.stats && Object.keys(job.stats).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {Object.entries(job.stats).map(([key, value]) => (
                          <span key={key} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-400">
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">{formatDate(job.createdAt)}</div>
                    {job.updatedAt !== job.createdAt && (
                      <div className="text-xs text-gray-600">Updated {formatDate(job.updatedAt)}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {sources.length === 0 ? (
              <div className="text-center text-gray-500 py-8">No discovery sources configured</div>
            ) : (
              sources.map((source) => (
                <div
                  key={source.id}
                  className="flex items-center gap-4 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 hover:border-gray-700 transition-colors"
                >
                  <Database className="w-5 h-5 text-indigo-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-200">{source.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="px-1.5 py-0.5 rounded bg-gray-800 text-xs text-gray-400">{source.type}</span>
                      <span className="text-xs text-gray-500">ID: {source.id.slice(0, 8)}</span>
                    </div>
                    {source.config && Object.keys(source.config).length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {Object.entries(source.config).map(([key, value]) => (
                          <span key={key} className="px-2 py-0.5 rounded bg-gray-800 text-xs text-gray-400">
                            {key}: {String(value)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">{formatDate(source.createdAt)}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
