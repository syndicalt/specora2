import { useState, useEffect } from "react";
import type { ShellAPI } from "@/sdk/types";
import { getToken } from "@/lib/auth";
import { ImpactGraph } from "@/components/ImpactGraph";
import { GitPullRequest, Calendar, Server, MessageSquare, CheckCircle, XCircle, Edit3, ChevronLeft, Loader2, Save, Trash2 } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";

interface RFC {
  id: string;
  ci_id: string;
  title: string;
  description: string;
  status: string;
  requester_id: string;
  approver_id: string;
  scheduled_at: string;
  planned_start_at: string;
  planned_end_at: string;
  created_at: string;
  affectedCis?: { ciId: string; role: string; name?: string }[];
  approvers?: { user_id: string; name: string; email: string; role: string; approved_at: string | null }[];
  comments?: { id: string; content: string; author: string; created_at: string }[];
}

export default function ChangeManagerApp({ shell }: { shell: ShellAPI }) {
  const [rfcs, setRfcs] = useState<RFC[]>([]);
  const [selectedRfc, setSelectedRfc] = useState<RFC | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [impactData, setImpactData] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<RFC>>({});
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    fetchRfcs();
  }, []);

  useEffect(() => {
    if (selectedRfc?.id) {
      fetchRfcDetails(selectedRfc.id);
    }
  }, [selectedRfc?.id]);

  // Listen for FOCUS_RFC messages from chat
  useEffect(() => {
    const unsubscribe = shell.onMessage((msg: any) => {
      if (msg.type === "FOCUS_RFC" && msg.payload?.rfcId) {
        const rfcId = msg.payload.rfcId;
        const existing = rfcs.find((r) => r.id === rfcId);
        if (existing) {
          setSelectedRfc(existing);
        } else {
          fetchRfcDetails(rfcId);
        }
        // Always refresh the list in case a new RFC was created while the app was open
        fetchRfcs();
      }
    });
    return unsubscribe;
  }, [shell, rfcs]);

  // Subscribe to real-time RFC events
  useEffect(() => {
    const unsubCreated = shell.eventBus.subscribe("rfc.created", () => fetchRfcs());
    const unsubUpdated = shell.eventBus.subscribe("rfc.updated", (payload: any) => {
      if (selectedRfc?.id === payload.rfcId) {
        fetchRfcDetails(payload.rfcId);
      }
      fetchRfcs();
    });
    const unsubStatus = shell.eventBus.subscribe("rfc.status_changed", (payload: any) => {
      if (selectedRfc?.id === payload.rfcId) {
        fetchRfcDetails(payload.rfcId);
      }
      fetchRfcs();
    });
    const unsubDeleted = shell.eventBus.subscribe("rfc.deleted", (payload: any) => {
      if (selectedRfc?.id === payload.rfcId) {
        setSelectedRfc(null);
        setImpactData(null);
      }
      fetchRfcs();
    });
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubStatus();
      unsubDeleted();
    };
  }, [shell, selectedRfc?.id]);

  async function fetchRfcs() {
    try {
      const res = await fetch(`${API_URL}/api/apps/change-manager/tools/list_rfcs`, {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessage({ type: "error", text: data.error || `Failed to load RFCs (${res.status})` });
      } else if (Array.isArray(data)) {
        setRfcs(data);
      } else {
        setRfcs([]);
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to load RFCs" });
    } finally {
      setLoading(false);
    }
  }

  async function fetchRfcDetails(rfcId: string) {
    try {
      const res = await fetch(`${API_URL}/api/apps/change-manager/tools/get_rfc_details?rfcId=${rfcId}`, {
        headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessage({ type: "error", text: data.error || `Failed to load RFC details (${res.status})` });
        return;
      }
      setSelectedRfc(data);
      // Ensure the RFC is in the list
      setRfcs((prev) => {
        if (prev.some((r) => r.id === data.id)) return prev;
        return [data, ...prev];
      });
      // Build impact graph data using real Neo4j relationships
      const nodes = (data.affectedCis || []).map((ci: any) => ({
        id: ci.ciId,
        name: ci.name || ci.ciId,
        class: "CI",
        role: ci.role === "primary" ? "primary" : ci.role === "affected" ? "affected" : "dependency",
      }));
      // Use real edges from Neo4j if available; otherwise show nodes without fabricated edges
      const edges = (data.edges || []).map((e: any) => ({
        sourceId: e.sourceId,
        targetId: e.targetId,
        type: e.type,
      }));
      setImpactData({ nodes, edges });
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Failed to load RFC details" });
    }
  }

  async function callTool(toolName: string, body: Record<string, unknown>) {
    const token = getToken();
    const res = await fetch(`${API_URL}/api/apps/change-manager/tools/${toolName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token || ""}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || `Failed to ${toolName}`);
    }
    return data;
  }

  async function handleApprove() {
    if (!selectedRfc) return;
    setActionLoading("approve");
    setMessage(null);
    try {
      const data = await callTool("approve_rfc", { rfcId: selectedRfc.id });
      setMessage({ type: "success", text: data.allApproversApproved ? "RFC approved." : "Approval recorded. Waiting for remaining approvers." });
      await fetchRfcDetails(selectedRfc.id);
      await fetchRfcs();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject() {
    if (!selectedRfc || !rejectReason.trim()) return;
    setActionLoading("reject");
    setMessage(null);
    try {
      await callTool("reject_rfc", { rfcId: selectedRfc.id, reason: rejectReason.trim() });
      setMessage({ type: "success", text: "RFC rejected." });
      setShowRejectInput(false);
      setRejectReason("");
      await fetchRfcDetails(selectedRfc.id);
      await fetchRfcs();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete() {
    if (!selectedRfc) return;
    setActionLoading("delete");
    setMessage(null);
    try {
      await callTool("delete_rfc", { rfcId: selectedRfc.id });
      setMessage({ type: "success", text: "RFC deleted." });
      setShowDeleteConfirm(false);
      setSelectedRfc(null);
      setImpactData(null);
      await fetchRfcs();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(null);
    }
  }

  function isoToDateTime(iso?: string): { date: string; time: string } | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const date = d.toISOString().slice(0, 10);
    const time = d.toISOString().slice(11, 16);
    return { date, time };
  }

  async function handleSaveEdit() {
    if (!selectedRfc) return;
    setActionLoading("edit");
    setMessage(null);
    try {
      const body: Record<string, unknown> = { rfcId: selectedRfc.id };
      if (editForm.title !== undefined && editForm.title !== selectedRfc.title) body.title = editForm.title;
      if (editForm.description !== undefined && editForm.description !== selectedRfc.description) body.description = editForm.description;
      if (editForm.status !== undefined && editForm.status !== selectedRfc.status) body.status = editForm.status;
      if (editForm.planned_start_at !== undefined && editForm.planned_start_at !== selectedRfc.planned_start_at) {
        const st = isoToDateTime(editForm.planned_start_at);
        if (st) { body.plannedStartDate = st.date; body.plannedStartTime = st.time; }
      }
      if (editForm.planned_end_at !== undefined && editForm.planned_end_at !== selectedRfc.planned_end_at) {
        const en = isoToDateTime(editForm.planned_end_at);
        if (en) { body.plannedEndDate = en.date; body.plannedEndTime = en.time; }
      }
      await callTool("edit_rfc", body);
      setMessage({ type: "success", text: "RFC updated." });
      setEditMode(false);
      await fetchRfcDetails(selectedRfc.id);
      await fetchRfcs();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setActionLoading(null);
    }
  }

  const canEdit = selectedRfc && !["implemented", "closed", "rejected"].includes(selectedRfc.status);
  const canApprove = selectedRfc && selectedRfc.status === "pending_approval";
  const canReject = selectedRfc && selectedRfc.status === "pending_approval";
  const canDelete = selectedRfc && selectedRfc.status === "draft";

  const filtered = rfcs.filter((r) => (filter ? r.status === filter : true));

  const statusColors: Record<string, string> = {
    draft: "bg-gray-700 text-gray-300",
    pending_approval: "bg-yellow-900/50 text-yellow-300",
    approved: "bg-green-900/50 text-green-300",
    implemented: "bg-blue-900/50 text-blue-300",
    closed: "bg-gray-800 text-gray-500",
    rejected: "bg-red-900/50 text-red-300",
    rolled_back: "bg-orange-900/50 text-orange-300",
  };

  if (selectedRfc) {
    return (
      <div className="h-full w-full bg-gray-950 text-gray-100 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-4">
          <button
            onClick={() => { setSelectedRfc(null); setImpactData(null); }}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{selectedRfc.title}</h1>
            <p className="text-xs text-gray-500">{selectedRfc.id}</p>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${statusColors[selectedRfc.status] || "bg-gray-800 text-gray-400"}`}>
            {selectedRfc.status.replace("_", " ")}
          </span>
        </div>

        <div className="flex-1 overflow-auto p-6 pb-24">
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Info grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                  <Server className="w-3.5 h-3.5" /> Primary CI
                </div>
                <div className="text-sm font-medium">{selectedRfc.ci_id}</div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                  <Calendar className="w-3.5 h-3.5" /> Planned Start
                </div>
                <div className="text-sm font-medium">
                  {selectedRfc.planned_start_at ? new Date(selectedRfc.planned_start_at).toLocaleString() : "Not set"}
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                  <Calendar className="w-3.5 h-3.5" /> Planned End
                </div>
                <div className="text-sm font-medium">
                  {selectedRfc.planned_end_at ? new Date(selectedRfc.planned_end_at).toLocaleString() : "Not set"}
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                  <GitPullRequest className="w-3.5 h-3.5" /> Created
                </div>
                <div className="text-sm font-medium">
                  {new Date(selectedRfc.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>

            {/* Description */}
            {selectedRfc.description && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-2">Description</h3>
                <p className="text-sm text-gray-400">{selectedRfc.description}</p>
              </div>
            )}

            {/* Impact Graph */}
            {impactData && impactData.nodes.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Impact Graph (3 hops)</h3>
                <ImpactGraph nodes={impactData.nodes} edges={impactData.edges} height={320} />
              </div>
            )}

            {/* Affected CIs list */}
            {selectedRfc.affectedCis && selectedRfc.affectedCis.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Affected CIs</h3>
                <div className="space-y-2">
                  {selectedRfc.affectedCis.map((ci) => (
                    <div key={ci.ciId} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/50">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${ci.role === "primary" ? "bg-indigo-500" : ci.role === "affected" ? "bg-orange-500" : "bg-emerald-500"}`} />
                        <span className="text-sm text-gray-300">{ci.name || ci.ciId}</span>
                        <span className="text-xs text-gray-500 font-mono">{ci.ciId}</span>
                      </div>
                      <span className="text-xs text-gray-500 capitalize">{ci.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approvers */}
            {selectedRfc.approvers && selectedRfc.approvers.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3">Approvers</h3>
                <div className="space-y-2">
                  {selectedRfc.approvers.map((a) => (
                    <div key={a.user_id} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/50">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-300">{a.name || a.email}</span>
                        <span className="text-xs text-gray-500 capitalize">{a.role}</span>
                      </div>
                      {a.approved_at ? (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <CheckCircle className="w-3.5 h-3.5" /> Approved
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-yellow-400">
                          <XCircle className="w-3.5 h-3.5" /> Pending
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            {selectedRfc.comments && selectedRfc.comments.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4" /> Comments
                </h3>
                <div className="space-y-3">
                  {selectedRfc.comments.map((c) => (
                    <div key={c.id} className="border-l-2 border-gray-700 pl-3">
                      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                        <span className="font-medium text-gray-400">{c.author || "Unknown"}</span>
                        <span>{new Date(c.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm text-gray-300">{c.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Message */}
            {message && (
              <div className={`p-3 rounded-lg text-sm border ${message.type === "success" ? "bg-green-900/30 border-green-800 text-green-300" : "bg-red-900/30 border-red-800 text-red-300"}`}>
                {message.text}
              </div>
            )}

            {/* Edit Form */}
            {editMode && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
                <h3 className="text-sm font-medium text-gray-300">Edit RFC</h3>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Title</label>
                  <input
                    type="text"
                    value={editForm.title ?? selectedRfc.title}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Description</label>
                  <textarea
                    value={editForm.description ?? selectedRfc.description}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Status</label>
                    <select
                      value={editForm.status ?? selectedRfc.status}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                    >
                      {["draft", "pending_approval", "approved", "implemented", "closed", "rejected"].map((s) => (
                        <option key={s} value={s}>{s.replace("_", " ")}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Planned Start</label>
                    <input
                      type="datetime-local"
                      value={editForm.planned_start_at ? new Date(editForm.planned_start_at).toISOString().slice(0, 16) : selectedRfc.planned_start_at ? new Date(selectedRfc.planned_start_at).toISOString().slice(0, 16) : ""}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, planned_start_at: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Planned End</label>
                    <input
                      type="datetime-local"
                      value={editForm.planned_end_at ? new Date(editForm.planned_end_at).toISOString().slice(0, 16) : selectedRfc.planned_end_at ? new Date(selectedRfc.planned_end_at).toISOString().slice(0, 16) : ""}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, planned_end_at: e.target.value ? new Date(e.target.value).toISOString() : undefined }))}
                      className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSaveEdit}
                    disabled={actionLoading === "edit"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "edit" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save
                  </button>
                  <button
                    onClick={() => { setEditMode(false); setEditForm({}); }}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Reject Reason */}
            {showRejectInput && (
              <div className="bg-gray-900 border border-red-800/50 rounded-xl p-4 space-y-3">
                <label className="block text-sm font-medium text-red-300">Rejection Reason</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this RFC being rejected?"
                  className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-200 focus:outline-none focus:border-red-500"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleReject}
                    disabled={actionLoading === "reject" || !rejectReason.trim()}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                    Confirm Reject
                  </button>
                  <button
                    onClick={() => { setShowRejectInput(false); setRejectReason(""); }}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Delete confirmation */}
            {showDeleteConfirm && (
              <div className="bg-gray-900 border border-red-800/50 rounded-xl p-4 space-y-3">
                <p className="text-sm text-red-300">Are you sure you want to delete this draft RFC? This action cannot be undone.</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDelete}
                    disabled={actionLoading === "delete"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Confirm Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Actions */}
            {!editMode && !showRejectInput && !showDeleteConfirm && (
              <div className="flex items-center gap-3">
                {canApprove && (
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading === "approve"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                    Approve
                  </button>
                )}
                {canReject && (
                  <button
                    onClick={() => setShowRejectInput(true)}
                    disabled={actionLoading === "reject"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" /> Reject
                  </button>
                )}
                {canEdit && (
                  <button
                    onClick={() => { setEditMode(true); setEditForm({}); }}
                    disabled={actionLoading === "edit"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Edit3 className="w-4 h-4" /> Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={actionLoading === "delete"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-gray-950 text-gray-100 flex flex-col">
      <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Change Manager</h1>
        <div className="flex gap-2">
          {["", "draft", "pending_approval", "approved", "implemented", "closed", "rejected"].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                filter === s ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {s ? s.replace("_", " ") : "All"}
            </button>
          ))}
        </div>
      </header>

      {message && !selectedRfc && (
        <div className={`px-6 py-2 text-sm ${message.type === "error" ? "bg-red-900/30 text-red-300" : "bg-green-900/30 text-green-300"}`}>
          {message.text}
        </div>
      )}
      <div className="flex-1 overflow-auto p-6 pb-24">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p className="text-lg font-medium">No change requests found</p>
            <p className="text-sm mt-1">Create an RFC from the chat or upload a discovery file.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((rfc) => (
              <button
                key={rfc.id}
                onClick={() => setSelectedRfc(rfc)}
                className="text-left p-4 bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-medium text-gray-200 line-clamp-1">{rfc.title}</h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusColors[rfc.status] || "bg-gray-800 text-gray-400"}`}>
                    {rfc.status.replace("_", " ")}
                  </span>
                </div>
                <p className="text-sm text-gray-500 line-clamp-2 mb-3">{rfc.description || "No description"}</p>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Server className="w-3 h-3" /> {rfc.ci_id}
                  </span>
                  <span>{new Date(rfc.created_at).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
