"use client";

import { useEffect, useState } from "react";
import { graphqlClient } from "@/lib/api";
import { X, Network } from "lucide-react";

interface CI {
  id: string;
  name: string;
  class: string;
  environment?: string;
  attributes?: Record<string, any>;
  dataQualityScore?: number;
  health?: {
    overall?: number;
  };
}

interface Relationship {
  type: string;
  target: CI;
}

export function DetailPanel({
  ci,
  onClose,
  onViewInMap,
}: {
  ci: CI;
  onClose: () => void;
  onViewInMap: (id: string) => void;
}) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await graphqlClient.request(
          `query GetCIDetails($id: ID!) {
            ci(id: $id) {
              relationships { type target { id name class } }
            }
          }`,
          { id: ci.id }
        );
        setRelationships(((data as any).ci?.relationships || []) as Relationship[]);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [ci.id]);

  return (
    <div className="absolute inset-y-0 right-0 w-80 bg-gray-900 border-l border-gray-800 shadow-[-8px_0_32px_rgba(0,0,0,0.4)] flex flex-col z-30 animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <h3 className="font-semibold text-sm text-gray-200 truncate">{ci.name}</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Basic info */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">ID</span>
            <span className="text-gray-300 font-mono text-xs">{ci.id}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">Class</span>
            <span className="text-gray-300">{ci.class}</span>
          </div>
          {ci.environment && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Environment</span>
              <span className="text-gray-300">{ci.environment}</span>
            </div>
          )}
          {ci.dataQualityScore !== undefined && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Health</span>
              <span className={`font-medium ${ci.dataQualityScore >= 80 ? "text-green-400" : ci.dataQualityScore >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                {ci.dataQualityScore}%
              </span>
            </div>
          )}
        </div>

        {/* Attributes */}
        {ci.attributes && Object.keys(ci.attributes).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Attributes</h4>
            <div className="space-y-1.5">
              {Object.entries(ci.attributes).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 capitalize">{key}</span>
                  <span className="text-gray-300 truncate max-w-[120px]">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Relationships */}
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Relationships</h4>
          {loading ? (
            <div className="text-sm text-gray-500 animate-pulse">Loading...</div>
          ) : relationships.length === 0 ? (
            <div className="text-sm text-gray-500">No relationships</div>
          ) : (
            <div className="space-y-1.5">
              {relationships.map((rel, i) => (
                <div key={i} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg bg-gray-800/60">
                  <span className="text-indigo-400 text-xs font-medium">{rel.type}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-300 truncate">{rel.target.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="pt-2">
          <button
            onClick={() => onViewInMap(ci.id)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors text-sm"
          >
            <Network className="w-4 h-4" />
            View in Service Map
          </button>
        </div>
      </div>
    </div>
  );
}
