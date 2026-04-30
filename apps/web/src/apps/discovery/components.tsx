import type { ReactNode } from "react";
import type { Node } from "reactflow";
import { MousePointer2, Play, Plus, Trash2, X } from "lucide-react";
import { NODE_CATALOG, catalogFor } from "./flow";
import { pct } from "./helpers";
import type { DiscoveryFlowNodeData, DiscoveryNodeKind, EdgeObservationProfile, PipelineSchedule, TargetClass, TransformProposal } from "./types";

export function ReviewBlock({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-200">
        <span className="text-cyan-300">{icon}</span>
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function NodeInspector({
  selectedNode,
  onChange,
  onRun,
  onDuplicate,
  onDelete,
  edgeCount,
  currentPipelineId,
  schedule,
  onScheduleChange,
  onSaveSchedule,
  saving,
}: {
  selectedNode: Node<DiscoveryFlowNodeData> | null;
  onChange: (patch: Partial<DiscoveryFlowNodeData>) => void;
  onRun: (kind: DiscoveryNodeKind) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  edgeCount: number;
  currentPipelineId: string | null;
  schedule: PipelineSchedule;
  onScheduleChange: (schedule: PipelineSchedule) => void;
  onSaveSchedule: () => void;
  saving: boolean;
}) {
  if (!selectedNode) {
    return (
      <section className="mb-4 rounded-lg border border-dashed border-gray-800 bg-gray-900/60 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <MousePointer2 className="h-4 w-4 text-cyan-300" />
          Select a canvas step
        </div>
        <p className="mt-2 text-sm text-gray-500">Click a node to configure its role, run its local action, duplicate it, or remove it from the pipeline definition.</p>
      </section>
    );
  }

  const catalog = catalogFor(selectedNode.data.kind);
  const Icon = catalog.icon;
  const titleId = `discovery-node-title-${selectedNode.id}`;
  const detailId = `discovery-node-detail-${selectedNode.id}`;
  const kindId = `discovery-node-kind-${selectedNode.id}`;
  const actionLabel =
    selectedNode.data.kind === "transform" || selectedNode.data.kind === "router" ? "AI draft from here" :
    selectedNode.data.kind === "validator" || selectedNode.data.kind === "stage" ? "Preview through here" :
    selectedNode.data.kind === "target" ? "Run published target" :
    selectedNode.data.kind === "schedule" ? "Save schedule" :
    "Run step check";

  return (
    <section className="mb-4 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-950" style={{ color: selectedNode.data.color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-cyan-50">Canvas Inspector</h2>
            <p className="text-xs text-cyan-100/60">{edgeCount} connected edge{edgeCount === 1 ? "" : "s"}</p>
          </div>
        </div>
        <button onClick={onDelete} className="rounded-md p-2 text-cyan-100/70 hover:bg-rose-500/20 hover:text-rose-200" title="Delete node">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-3">
        <label htmlFor={kindId} className="block text-xs text-cyan-100/60">Step type</label>
        <select
          id={kindId}
          value={selectedNode.data.kind}
          onChange={(event) => {
            const kind = event.target.value as DiscoveryNodeKind;
            const next = catalogFor(kind);
            onChange({ kind, title: next.title, detail: next.detail, color: next.color });
          }}
          className="w-full rounded-md border border-cyan-500/20 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
        >
          {NODE_CATALOG.map((item) => <option key={item.kind} value={item.kind}>{item.title}</option>)}
        </select>

        <label htmlFor={titleId} className="block text-xs text-cyan-100/60">Title</label>
        <input
          id={titleId}
          value={selectedNode.data.title}
          onChange={(event) => onChange({ title: event.target.value })}
          className="w-full rounded-md border border-cyan-500/20 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
        />

        <label htmlFor={detailId} className="block text-xs text-cyan-100/60">Behavior note</label>
        <textarea
          id={detailId}
          value={selectedNode.data.detail}
          onChange={(event) => onChange({ detail: event.target.value })}
          className="h-20 w-full resize-none rounded-md border border-cyan-500/20 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400"
        />

        {selectedNode.data.kind === "schedule" && (
          <div className="rounded-lg border border-cyan-500/20 bg-gray-950 p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-cyan-50">Pipeline trigger</div>
                <div className="mt-1 text-xs leading-5 text-cyan-100/60">
                  {currentPipelineId ? "Configure when this saved pipeline should run." : "Save the pipeline before enabling a recurring trigger."}
                </div>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs text-cyan-100/80">
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={(event) => onScheduleChange({ ...schedule, enabled: event.target.checked })}
                  disabled={!currentPipelineId}
                />
                Enabled
              </label>
            </div>

            <label className="block text-xs text-cyan-100/60">Frequency</label>
            <select
              value={schedule.interval}
              onChange={(event) => onScheduleChange({ ...schedule, interval: event.target.value })}
              disabled={!currentPipelineId}
              className="mt-1 w-full rounded-md border border-cyan-500/20 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400 disabled:opacity-50"
            >
              <option value="manual">Manual only</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>

            <label className="mt-3 block text-xs text-cyan-100/60">Next run</label>
            <input
              type="datetime-local"
              value={schedule.next_run_at ? schedule.next_run_at.slice(0, 16) : ""}
              onChange={(event) => onScheduleChange({ ...schedule, next_run_at: event.target.value ? new Date(event.target.value).toISOString() : null })}
              disabled={!currentPipelineId || schedule.interval === "manual"}
              className="mt-1 w-full rounded-md border border-cyan-500/20 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-400 disabled:opacity-50"
            />

            <button
              onClick={onSaveSchedule}
              disabled={!currentPipelineId || saving}
              className="mt-3 w-full rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Save trigger
            </button>

            <div className="mt-3 space-y-1 text-xs text-cyan-100/60">
              {schedule.last_run_at && <div>Last run {new Date(schedule.last_run_at).toLocaleString()}</div>}
              {schedule.last_status && <div>Last status {schedule.last_status}{schedule.last_discovery_job_id ? ` · ${schedule.last_discovery_job_id.slice(0, 8)}` : ""}</div>}
              {schedule.last_error && <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200">{schedule.last_error}</div>}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onRun(selectedNode.data.kind)} className="flex items-center justify-center gap-2 rounded-md bg-cyan-400 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-cyan-300">
            <Play className="h-4 w-4" />
            {actionLabel}
          </button>
          <button onClick={onDuplicate} className="flex items-center justify-center gap-2 rounded-md border border-cyan-500/30 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/10">
            <Plus className="h-4 w-4" />
            Duplicate
          </button>
        </div>
      </div>
    </section>
  );
}

export function ReviewRow({ primary, secondary, metric }: { primary: string; secondary: string; metric: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-gray-950 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm text-gray-200">{primary}</div>
        <div className="truncate text-xs text-gray-500">{secondary}</div>
      </div>
      <span className="shrink-0 text-xs text-gray-400">{metric}</span>
    </div>
  );
}

function MappingEditor({
  mapping,
  classes,
  columns,
  onChange,
  onDelete,
}: {
  mapping: TransformProposal["fieldMappings"][number];
  classes: TargetClass[];
  columns: string[];
  onChange: (patch: Partial<TransformProposal["fieldMappings"][number]>) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{mapping.sourceField} to {mapping.targetClass}.{mapping.targetField}</span>
        {onDelete && (
          <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete field mapping">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={mapping.sourceField} onChange={(event) => onChange({ sourceField: event.target.value })} className="min-w-0 rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...columns, mapping.sourceField])).map((column) => <option key={column} value={column}>{column}</option>)}
        </select>
        <select value={mapping.targetClass} onChange={(event) => onChange({ targetClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {classes.map((cls) => <option key={cls.name} value={cls.name}>{cls.displayName || cls.name}</option>)}
          {!classes.some((cls) => cls.name === mapping.targetClass) && <option value={mapping.targetClass}>{mapping.targetClass}</option>}
        </select>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input value={mapping.targetField} onChange={(event) => onChange({ targetField: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500" />
        <select value={mapping.transform} onChange={(event) => onChange({ transform: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {["trim", "trim_lowercase", "normalize_environment"].map((transform) => <option key={transform} value={transform}>{transform}</option>)}
        </select>
      </div>
      <RationalePanel
        confidence={mapping.confidence}
        rationale={mapping.rationale}
        evidence={mapping.evidence}
        alternatives={mapping.alternatives}
      />
    </div>
  );
}

function RelationshipEditor({
  rule,
  classes,
  columns,
  onChange,
  onDelete,
}: {
  rule: TransformProposal["relationshipRules"][number];
  classes: TargetClass[];
  columns: string[];
  onChange: (patch: Partial<TransformProposal["relationshipRules"][number]>) => void;
  onDelete?: () => void;
}) {
  const classNames = classes.map((cls) => cls.name);
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{rule.fromClass} {rule.type} {rule.toClass}</span>
        {onDelete && (
          <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete relationship rule">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select value={rule.fromClass} onChange={(event) => onChange({ fromClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classNames, rule.fromClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={rule.type} onChange={(event) => onChange({ type: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {["DEPENDS_ON", "HOSTED_ON", "OWNED_BY", "MANAGED_BY", "PART_OF", "LOCATED_AT"].map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={rule.toClass} onChange={(event) => onChange({ toClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classNames, rule.toClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <select value={rule.sourceField} onChange={(event) => onChange({ sourceField: event.target.value })} className="mt-2 w-full rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
        {Array.from(new Set([...columns, rule.sourceField])).map((column) => <option key={column} value={column}>{column}</option>)}
      </select>
      <RationalePanel confidence={rule.confidence} rationale={rule.rationale} evidence={rule.evidence} />
    </div>
  );
}

function ClassRouteEditor({
  route,
  classes,
  onChange,
  onDelete,
}: {
  route: TransformProposal["classRoutes"][number];
  classes: TargetClass[];
  onChange: (patch: Partial<TransformProposal["classRoutes"][number]>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{route.sourcePattern || "route"} to {route.targetClass}</span>
        <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete class route">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={route.sourcePattern} onChange={(event) => onChange({ sourcePattern: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500" />
        <select value={route.targetClass} onChange={(event) => onChange({ targetClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classes.map((cls) => cls.name), route.targetClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      <textarea value={route.rationale} onChange={(event) => onChange({ rationale: event.target.value })} className="mt-2 h-16 w-full resize-none rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500" />
      <label className="mt-2 block text-[11px] text-gray-500">Confidence {pct(route.confidence)}</label>
      <input type="range" min="0" max="1" step="0.01" value={route.confidence} onChange={(event) => onChange({ confidence: Number(event.target.value) })} className="w-full" />
    </div>
  );
}

function ReconciliationEditor({
  rule,
  classes,
  onChange,
  onDelete,
}: {
  rule: TransformProposal["reconciliationRules"][number];
  classes: TargetClass[];
  onChange: (patch: Partial<TransformProposal["reconciliationRules"][number]>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md bg-gray-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-400">{rule.targetClass} by {rule.matchKeys.join(", ") || "no keys"}</span>
        <button onClick={onDelete} className="rounded p-1 text-gray-500 hover:bg-rose-500/10 hover:text-rose-300" aria-label="Delete reconciliation rule">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={rule.targetClass} onChange={(event) => onChange({ targetClass: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {Array.from(new Set([...classes.map((cls) => cls.name), rule.targetClass])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select value={rule.strategy} onChange={(event) => onChange({ strategy: event.target.value })} className="rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs">
          {["create_or_update", "update", "review"].map((strategy) => <option key={strategy} value={strategy}>{strategy}</option>)}
        </select>
      </div>
      <input
        value={rule.matchKeys.join(", ")}
        onChange={(event) => onChange({ matchKeys: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })}
        className="mt-2 w-full rounded border border-gray-800 bg-gray-900 px-2 py-1.5 text-xs outline-none focus:border-cyan-500"
        placeholder="name, ipAddress"
      />
    </div>
  );
}

export function PipelineNodeWindow({
  node,
  proposal,
  classes,
  sourceFields,
  edgeProfiles,
  onClose,
  onUpdateNode,
  onAddClassRoute,
  onUpdateClassRoute,
  onDeleteClassRoute,
  onAddMapping,
  onUpdateMapping,
  onDeleteMapping,
  onAddRelationship,
  onUpdateRelationship,
  onDeleteRelationship,
  onAddReconciliation,
  onUpdateReconciliation,
  onDeleteReconciliation,
}: {
  node: Node<DiscoveryFlowNodeData>;
  proposal: TransformProposal | null;
  classes: TargetClass[];
  sourceFields: string[];
  edgeProfiles: EdgeObservationProfile[];
  onClose: () => void;
  onUpdateNode: (patch: Partial<DiscoveryFlowNodeData>) => void;
  onAddClassRoute: () => void;
  onUpdateClassRoute: (index: number, patch: Partial<TransformProposal["classRoutes"][number]>) => void;
  onDeleteClassRoute: (index: number) => void;
  onAddMapping: () => void;
  onUpdateMapping: (index: number, patch: Partial<TransformProposal["fieldMappings"][number]>) => void;
  onDeleteMapping: (index: number) => void;
  onAddRelationship: () => void;
  onUpdateRelationship: (index: number, patch: Partial<TransformProposal["relationshipRules"][number]>) => void;
  onDeleteRelationship: (index: number) => void;
  onAddReconciliation: () => void;
  onUpdateReconciliation: (index: number, patch: Partial<TransformProposal["reconciliationRules"][number]>) => void;
  onDeleteReconciliation: (index: number) => void;
}) {
  const catalog = catalogFor(node.data.kind);
  const Icon = catalog.icon;
  return (
    <div className="absolute inset-4 z-30 overflow-hidden rounded-lg border border-gray-700 bg-gray-950 shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gray-950" style={{ color: node.data.color }}>
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-100">{node.data.title}</div>
            <div className="truncate text-xs text-gray-500">Right-click node detail · {node.data.kind}</div>
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100" aria-label="Close node details">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid h-[calc(100%-58px)] min-h-0 grid-cols-1 xl:grid-cols-[320px_1fr]">
        <div className="border-b border-gray-800 p-4 xl:border-b-0 xl:border-r">
          <label className="block text-xs text-gray-500">Title</label>
          <input value={node.data.title} onChange={(event) => onUpdateNode({ title: event.target.value })} className="mt-1 w-full rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          <label className="mt-3 block text-xs text-gray-500">Behavior note</label>
          <textarea value={node.data.detail} onChange={(event) => onUpdateNode({ detail: event.target.value })} className="mt-1 h-28 w-full resize-none rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-cyan-500" />
          <div className="mt-4 rounded-md border border-gray-800 bg-gray-900 p-3 text-xs leading-5 text-gray-400">
            Use this window for full pipeline editing. The sidebar remains a preview/status surface.
          </div>
        </div>

        <div className="min-h-0 overflow-auto p-4">
          {!proposal ? (
            <div className="rounded-lg border border-dashed border-gray-800 p-8 text-center text-sm text-gray-500">Draft a transform before editing routes, mappings, relationships, or reconciliation.</div>
          ) : node.data.kind === "profile" ? (
            <div className="space-y-3">
              {(proposal.entityPlan || []).map((entity, index) => (
                <div key={`${entity.sourceEntity}-${index}`} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-100">{entity.sourceEntity}</span>
                    <span className="rounded bg-cyan-500/10 px-2 py-1 text-xs text-cyan-300">{entity.treatment}</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">{entity.target || "no target"}{entity.cardinality ? ` · ${entity.cardinality}` : ""}</div>
                  <p className="mt-2 text-sm leading-5 text-gray-400">{entity.rationale}</p>
                </div>
              ))}
              {edgeProfiles.map((profile) => (
                <div key={profile.entityType} className="rounded-md border border-gray-800 bg-gray-900 p-3">
                  <div className="text-sm font-medium text-gray-100">{profile.entityType}</div>
                  <div className="mt-1 text-xs text-gray-500">{profile.recordCount} records · {profile.columns.length} fields</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {profile.columns.slice(0, 24).map((column) => <span key={column} className="rounded bg-gray-950 px-2 py-1 text-[11px] text-gray-400">{column}</span>)}
                  </div>
                </div>
              ))}
            </div>
          ) : node.data.kind === "router" ? (
            <EditorSection title="Class Routes" onAdd={onAddClassRoute} addLabel="Add class route">
              {proposal.classRoutes.map((route, index) => (
                <ClassRouteEditor key={`${route.targetClass}-${index}`} route={route} classes={classes} onChange={(patch) => onUpdateClassRoute(index, patch)} onDelete={() => onDeleteClassRoute(index)} />
              ))}
            </EditorSection>
          ) : node.data.kind === "transform" ? (
            <EditorSection title="Field Mappings" onAdd={onAddMapping} addLabel="Add field mapping">
              {proposal.fieldMappings.map((mapping, index) => (
                <MappingEditor key={`${mapping.sourceField}-${index}`} mapping={mapping} classes={classes} columns={sourceFields} onChange={(patch) => onUpdateMapping(index, patch)} onDelete={() => onDeleteMapping(index)} />
              ))}
            </EditorSection>
          ) : node.data.kind === "linker" ? (
            <EditorSection title="Relationship Rules" onAdd={onAddRelationship} addLabel="Add relationship rule">
              {proposal.relationshipRules.map((rule, index) => (
                <RelationshipEditor key={`${rule.fromClass}-${rule.type}-${rule.toClass}-${index}`} rule={rule} classes={classes} columns={sourceFields} onChange={(patch) => onUpdateRelationship(index, patch)} onDelete={() => onDeleteRelationship(index)} />
              ))}
            </EditorSection>
          ) : node.data.kind === "reconcile" ? (
            <EditorSection title="Reconciliation Rules" onAdd={onAddReconciliation} addLabel="Add reconciliation rule">
              {proposal.reconciliationRules.map((rule, index) => (
                <ReconciliationEditor key={`${rule.targetClass}-${index}`} rule={rule} classes={classes} onChange={(patch) => onUpdateReconciliation(index, patch)} onDelete={() => onDeleteReconciliation(index)} />
              ))}
            </EditorSection>
          ) : (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm leading-6 text-gray-400">
              This node does not have a specialized pipeline editor yet. Use the left panel for node metadata and the sidebar for preview/run controls.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditorSection({ title, children, onAdd, addLabel }: { title: string; children: ReactNode; onAdd: () => void; addLabel: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-100">{title}</h3>
        <button onClick={onAdd} className="flex items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20">
          <Plus className="h-4 w-4" />
          {addLabel}
        </button>
      </div>
      {children}
    </div>
  );
}

function RationalePanel({ confidence, rationale, evidence, alternatives }: { confidence: number; rationale?: string; evidence?: string[]; alternatives?: string[] }) {
  const cleanEvidence = (evidence || []).filter(Boolean).slice(0, 3);
  const cleanAlternatives = (alternatives || []).filter(Boolean).slice(0, 3);
  return (
    <div className="mt-2 rounded border border-gray-800 bg-gray-900/70 px-2 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-600">Rationale</span>
        <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[11px] text-cyan-300">{pct(confidence)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-gray-400">{rationale || "No detailed rationale was supplied for this saved mapping."}</p>
      {cleanEvidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {cleanEvidence.map((item, index) => (
            <span key={`${item}-${index}`} className="max-w-full truncate rounded bg-gray-950 px-2 py-1 font-mono text-[11px] text-gray-500">
              {item}
            </span>
          ))}
        </div>
      )}
      {cleanAlternatives.length > 0 && (
        <div className="mt-2 text-[11px] text-gray-600">
          Alternatives: <span className="text-gray-500">{cleanAlternatives.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

export function PreviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-gray-950 p-2">
      <div className="text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-100">{value}</div>
    </div>
  );
}
