"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ShellAPI } from "@/sdk/types";
import {
  Activity,
  AlertTriangle,
  Bot,
  Building2,
  Cable,
  Fan,
  Grid3X3,
  Loader2,
  Network,
  Package,
  Power,
  Plus,
  Save,
  Server,
  Sparkles,
  Thermometer,
  Trash2,
  X,
  Zap,
} from "lucide-react";

type Overview = {
  package: {
    id: string;
    name: string;
    premium: boolean;
    entitlementMode: string;
    paymentReady: boolean;
  };
  summary: {
    sites: number;
    racks: number;
    assets: number;
    openEvents: number;
    openCriticalEvents: number;
    totalCapacityKw: number;
    usedKw: number;
    powerUtilization: number;
    avgRisk: number;
  };
  sites: any[];
  racks: any[];
  assets: any[];
  events: any[];
  floorplan: any | null;
};

const severityStyles: Record<string, string> = {
  critical: "border-red-500/40 bg-red-500/10 text-red-100",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-100",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  info: "border-indigo-500/40 bg-indigo-500/10 text-indigo-100",
};

const emptyRackForm = {
  name: "",
  rowLabel: "",
  positionLabel: "",
  ruTotal: "42",
  powerCapacityKw: "18",
  weightCapacityKg: "1200",
  redundancy: "A/B",
  status: "operational",
};

const emptyObjectForm = {
  label: "",
  width: "120",
  height: "80",
  rotation: "0",
};

const emptyConnectionForm = {
  label: "",
  connectionType: "network",
  status: "operational",
};

const floorplanPalette = [
  { type: "rack", label: "Rack", icon: Server, width: 120, height: 180, layer: "rack", style: { fill: "#047857" } },
  { type: "power", label: "UPS / PDU", icon: Power, width: 180, height: 100, layer: "power", style: { fill: "#ca8a04" } },
  { type: "cooling", label: "CRAC", icon: Fan, width: 180, height: 100, layer: "cooling", style: { fill: "#0891b2" } },
  { type: "network", label: "Patch Panel", icon: Network, width: 160, height: 80, layer: "network", style: { fill: "#4f46e5" } },
  { type: "sensor", label: "Sensor", icon: Thermometer, width: 110, height: 70, layer: "sensor", style: { fill: "#0f766e" } },
  { type: "marker", label: "Aisle Marker", icon: Grid3X3, width: 200, height: 56, layer: "marker", style: { fill: "#475569" } },
];

function objectToForm(object: any | null) {
  return {
    label: object?.label || "",
    width: String(Math.round(Number(object?.width || 120))),
    height: String(Math.round(Number(object?.height || 80))),
    rotation: String(Math.round(Number(object?.rotation || 0))),
  };
}

function connectionToForm(connection: any | null) {
  return {
    label: connection?.label || "",
    connectionType: connection?.connection_type || "network",
    status: connection?.status || "operational",
  };
}

type FloorplanNodeData = {
  object: any;
  rack?: any;
  hasEvent: boolean;
};

const nodeTypes = {
  rack: RackFlowNode,
  facility: FacilityFlowNode,
};

const connectionLineStyle = { stroke: "#818cf8", strokeWidth: 2 };

function rackToForm(rack: any) {
  return {
    name: rack?.name || "",
    rowLabel: rack?.row_label || "",
    positionLabel: rack?.position_label || "",
    ruTotal: String(rack?.ru_total || 42),
    powerCapacityKw: String(rack?.power_capacity_kw || 18),
    weightCapacityKg: String(rack?.weight_capacity_kg || 1200),
    redundancy: rack?.redundancy || "A/B",
    status: rack?.status || "operational",
  };
}

export default function ItVisibilityDcimApp({ shell }: { shell: ShellAPI }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedRackId, setSelectedRackId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<"overview" | "floorplan">("overview");
  const [selectedObjectId, setSelectedObjectId] = useState<string>("");
  const [rackForm, setRackForm] = useState(emptyRackForm);
  const [objectForm, setObjectForm] = useState(emptyObjectForm);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [connectionForm, setConnectionForm] = useState(emptyConnectionForm);
  const [creatingRack, setCreatingRack] = useState(false);

  async function loadOverview(mounted = true) {
    setLoading(true);
    return shell.fetch("/api/it-visibility/dcim/overview")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error || "DCIM data could not be loaded");
        return res.json();
      })
      .then((data) => {
        if (!mounted) return;
        setOverview(data);
        const objects = data.floorplan?.objects || [];
        const nextObject = objects.find((candidate: any) => candidate.object_type === "rack" && candidate.object_id === data.racks?.[0]?.id) || objects[0] || null;
        setSelectedObjectId((current) => objects.some((object: any) => object.id === current) ? current : nextObject?.id || "");
        setObjectForm((current) => current.label ? current : objectToForm(nextObject));
        setSelectedRackId((current) => data.racks?.some((rack: any) => rack.id === current) ? current : data.racks?.[0]?.id || "");
        setSelectedConnectionId("");
        setConnectionForm(emptyConnectionForm);
        setRackForm((current) => current.name ? current : data.racks?.[0] ? rackToForm(data.racks[0]) : emptyRackForm);
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
  }

  useEffect(() => {
    let mounted = true;
    loadOverview(mounted);
    return () => {
      mounted = false;
    };
  }, [shell]);

  const selectedRack = useMemo(() => overview?.racks.find((rack) => rack.id === selectedRackId), [overview, selectedRackId]);
  const selectedRackAssets = useMemo(
    () => overview?.assets.filter((asset) => asset.rack_id === selectedRackId) || [],
    [overview, selectedRackId]
  );
  const selectedRackEvents = useMemo(
    () => overview?.events.filter((event) => event.rack_id === selectedRackId) || [],
    [overview, selectedRackId]
  );
  const selectedFloorplanObject = useMemo(
    () => (overview?.floorplan?.objects || []).find((object: any) => object.id === selectedObjectId) || null,
    [overview, selectedObjectId]
  );
  const selectedConnection = useMemo(
    () => (overview?.floorplan?.connections || []).find((connection: any) => connection.id === selectedConnectionId) || null,
    [overview, selectedConnectionId]
  );

  function selectRack(rackId: string) {
    setSelectedRackId(rackId);
    const object = overview?.floorplan?.objects?.find((candidate: any) => candidate.object_type === "rack" && candidate.object_id === rackId);
    if (object) setSelectedObjectId(object.id);
    const rack = overview?.racks.find((candidate) => candidate.id === rackId);
    if (rack) setRackForm(rackToForm(rack));
    if (object) setObjectForm(objectToForm(object));
  }

  function selectFloorplanObject(object: any) {
    setSelectedObjectId(object.id);
    setSelectedConnectionId("");
    setObjectForm(objectToForm(object));
    if (object.object_type === "rack" && object.object_id) {
      const rack = overview?.racks.find((candidate) => candidate.id === object.object_id);
      setSelectedRackId(object.object_id);
      if (rack) setRackForm(rackToForm(rack));
    } else {
      setSelectedRackId("");
    }
  }

  function selectFloorplanConnection(connection: any) {
    setSelectedConnectionId(connection.id);
    setSelectedObjectId("");
    setSelectedRackId("");
    setConnectionForm(connectionToForm(connection));
  }

  async function planInstall() {
    setActionLoading("plan");
    setError(null);
    try {
      const res = await shell.fetch("/api/it-visibility/dcim/placement/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruHeight: 2, powerKw: 0.9, weightKg: 35, redundancy: "A/B" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Placement planning failed");
      setPlan(data);
      if (data.recommendation?.rack?.id) setSelectedRackId(data.recommendation.rack.id);
      shell.notify("Placement plan generated", "success");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function reserveRackSlot() {
    if (!selectedRack) return;
    setActionLoading("reserve");
    setError(null);
    try {
      const res = await shell.fetch("/api/it-visibility/dcim/rack-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rackId: selectedRack.id,
          name: `planned-node-${Date.now().toString().slice(-4)}`,
          assetType: "server",
          vendor: "Dell",
          model: "R760",
          ruHeight: 2,
          powerDrawKw: 0.8,
          networkPorts: 4,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rack assignment failed");
      shell.notify(`Reserved ${data.asset.name} in rack ${selectedRack.name}`, "success");
      await loadOverview(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function createRackEvent() {
    if (!selectedRack) return;
    setActionLoading("event");
    setError(null);
    try {
      const res = await shell.fetch("/api/it-visibility/dcim/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          externalRef: `manual-${selectedRack.id}-${Date.now()}`,
          severity: "warning",
          eventType: "capacity",
          title: `${selectedRack.name} capacity review requested`,
          description: "Manual operational event created from DCIM Command Center.",
          rackId: selectedRack.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Event creation failed");
      shell.notify(`Created event ${data.event.title}`, "success");
      await loadOverview(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function moveFloorplanObject(objectId: string, x: number, y: number) {
    if (!overview?.floorplan?.id) return;
    setDraggingObjectId(objectId);
    setError(null);
    const boundedX = Math.max(0, Math.round(x));
    const boundedY = Math.max(0, Math.round(y));
    setOverview((current) => current ? {
      ...current,
      floorplan: {
        ...current.floorplan,
        objects: (current.floorplan?.objects || []).map((object: any) =>
          object.id === objectId ? { ...object, x: boundedX, y: boundedY } : object
        ),
      },
    } : current);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/objects/${objectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ x: boundedX, y: boundedY }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save floorplan position");
    } catch (err: any) {
      setError(err.message);
      await loadOverview(true);
    } finally {
      setDraggingObjectId(null);
    }
  }

  async function updateSelectedFloorplanObject() {
    if (!overview?.floorplan?.id || !selectedFloorplanObject || !objectForm.label.trim()) return;
    setActionLoading("update-object");
    setError(null);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/objects/${selectedFloorplanObject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: objectForm.label.trim(),
          width: Number(objectForm.width || selectedFloorplanObject.width || 120),
          height: Number(objectForm.height || selectedFloorplanObject.height || 80),
          rotation: Number(objectForm.rotation || 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Floorplan object could not be updated");
      shell.notify(`Updated ${data.object.label}`, "success");
      setOverview((current) => current ? {
        ...current,
        floorplan: {
          ...current.floorplan,
          objects: (current.floorplan?.objects || []).map((object: any) =>
            object.id === data.object.id ? data.object : object
          ),
        },
      } : current);
      setSelectedObjectId(data.object.id);
      setSelectedConnectionId("");
      setObjectForm(objectToForm(data.object));
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function createFloorplanObject(item: (typeof floorplanPalette)[number]) {
    if (!overview?.floorplan?.id) return;
    if (item.type === "rack") {
      setCreatingRack(true);
      setSelectedConnectionId("");
      setRackForm(emptyRackForm);
      setObjectForm({ label: "", width: String(item.width), height: String(item.height), rotation: "0" });
      return;
    }
    setActionLoading(`create-object:${item.type}`);
    setError(null);
    setCreatingRack(false);
    setSelectedObjectId("");
    setSelectedConnectionId("");
    setObjectForm({ label: "", width: String(item.width), height: String(item.height), rotation: "0" });
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/objects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectType: item.type,
          label: `${item.label} ${(overview.floorplan.objects || []).filter((object: any) => object.object_type === item.type).length + 1}`,
          x: 80,
          y: 80,
          width: item.width,
          height: item.height,
          layer: item.layer,
          style: item.style,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Floorplan object could not be created");
      shell.notify(`Created ${data.object.label}`, "success");
      setOverview((current) => current ? {
        ...current,
        floorplan: {
          ...current.floorplan,
          objects: [...(current.floorplan?.objects || []), data.object],
        },
      } : current);
      setSelectedObjectId(data.object.id);
      setSelectedConnectionId("");
      setObjectForm(objectToForm(data.object));
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteSelectedFloorplanObject() {
    if (!overview?.floorplan?.id || !selectedFloorplanObject) return;
    setActionLoading("delete-object");
    setError(null);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/objects/${selectedFloorplanObject.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Floorplan object could not be removed");
      shell.notify(`Removed ${data.object.label} from floorplan`, "success");
      await loadOverview(true);
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function createFloorplanConnection(connection: Connection) {
    if (!overview?.floorplan?.id || !connection.source || !connection.target) return;
    setActionLoading("create-connection");
    setError(null);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/connections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceObjectId: connection.source,
          targetObjectId: connection.target,
          connectionType: connection.sourceHandle?.startsWith("power") || connection.targetHandle?.startsWith("power") ? "power" : "network",
          label: connection.sourceHandle && connection.targetHandle ? `${connection.sourceHandle} to ${connection.targetHandle}` : "Manual connection",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection could not be created");
      shell.notify("Floorplan connection created", "success");
      await loadOverview(true);
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function updateSelectedConnection() {
    if (!overview?.floorplan?.id || !selectedConnection) return;
    setActionLoading("update-connection");
    setError(null);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/connections/${selectedConnection.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: connectionForm.label.trim() || null,
          connectionType: connectionForm.connectionType,
          status: connectionForm.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection could not be updated");
      shell.notify("Connection updated", "success");
      await loadOverview(true);
      setSelectedConnectionId(data.connection.id);
      setConnectionForm(connectionToForm(data.connection));
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteSelectedConnection() {
    if (!overview?.floorplan?.id || !selectedConnection) return;
    setActionLoading("delete-connection");
    setError(null);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/floorplans/${overview.floorplan.id}/connections/${selectedConnection.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection could not be deleted");
      shell.notify(`Deleted ${data.connection.label || "connection"}`, "success");
      setSelectedConnectionId("");
      await loadOverview(true);
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function createRack() {
    if (!overview?.floorplan?.id || !rackForm.name.trim()) {
      shell.notify("Rack name is required", "error");
      return;
    }
    setActionLoading("create-rack");
    setError(null);
    try {
      const res = await shell.fetch("/api/it-visibility/dcim/racks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          floorplanId: overview.floorplan.id,
          name: rackForm.name.trim(),
          rowLabel: rackForm.rowLabel || null,
          positionLabel: rackForm.positionLabel || null,
          ruTotal: Number(rackForm.ruTotal || 42),
          powerCapacityKw: Number(rackForm.powerCapacityKw || 18),
          weightCapacityKg: Number(rackForm.weightCapacityKg || 1200),
          redundancy: rackForm.redundancy,
          status: rackForm.status,
          x: 80,
          y: 80,
          width: 120,
          height: 180,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rack could not be created");
      shell.notify(`Created rack ${data.rack.name}`, "success");
      setCreatingRack(false);
      setRackForm(emptyRackForm);
      await loadOverview(true);
      setSelectedRackId(data.rack.id);
      setSelectedObjectId(data.object.id);
      setObjectForm(objectToForm(data.object));
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  async function updateSelectedRack() {
    if (!selectedRack || !rackForm.name.trim()) return;
    setActionLoading("update-rack");
    setError(null);
    try {
      const res = await shell.fetch(`/api/it-visibility/dcim/racks/${selectedRack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: rackForm.name.trim(),
          rowLabel: rackForm.rowLabel || null,
          positionLabel: rackForm.positionLabel || null,
          ruTotal: Number(rackForm.ruTotal || selectedRack.ru_total || 42),
          powerCapacityKw: Number(rackForm.powerCapacityKw || selectedRack.power_capacity_kw || 18),
          weightCapacityKg: Number(rackForm.weightCapacityKg || selectedRack.weight_capacity_kg || 1200),
          redundancy: rackForm.redundancy,
          status: rackForm.status,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Rack could not be updated");
      shell.notify(`Updated rack ${data.rack.name}`, "success");
      await loadOverview(true);
      setSelectedRackId(data.rack.id);
    } catch (err: any) {
      setError(err.message);
      shell.notify(err.message, "error");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-950 text-gray-100">
        <div className="flex items-center gap-3 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-300" />
          Loading DCIM command model
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-950 text-gray-100">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-5 text-red-100">
          {error || "DCIM data could not be loaded"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-indigo-500/40 bg-indigo-500/10">
              <Network className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">DCIM Command Center</h1>
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-100">
                  {overview.package.name} premium
                </span>
              </div>
              <p className="text-sm text-gray-500">
                Facility topology, rack intelligence, power/cooling risk, and event correlation.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {[
              ["overview", "Command"],
              ["floorplan", "Floorplan"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id as "overview" | "floorplan")}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  activeView === id ? "bg-indigo-600 text-white" : "border border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
            <div className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-400">
              Entitlement: <span className="text-gray-200">{overview.package.entitlementMode}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 overflow-hidden">
        {activeView === "floorplan" ? (
          <FloorplanWorkspace
            overview={overview}
            selectedRack={selectedRack}
            selectedObject={selectedFloorplanObject}
            selectedConnection={selectedConnection}
            selectedRackId={selectedRackId}
            savingObjectId={draggingObjectId}
            rackForm={rackForm}
            objectForm={objectForm}
            connectionForm={connectionForm}
            creatingRack={creatingRack}
            actionLoading={actionLoading}
            onRackFormChange={(patch) => setRackForm((current) => ({ ...current, ...patch }))}
            onObjectFormChange={(patch) => setObjectForm((current) => ({ ...current, ...patch }))}
            onConnectionFormChange={(patch) => setConnectionForm((current) => ({ ...current, ...patch }))}
            onCreateRack={createRack}
            onUpdateRack={updateSelectedRack}
            onCreateObject={createFloorplanObject}
            onUpdateObject={updateSelectedFloorplanObject}
            onDeleteObject={deleteSelectedFloorplanObject}
            onUpdateConnection={updateSelectedConnection}
            onDeleteConnection={deleteSelectedConnection}
            onMoveObject={moveFloorplanObject}
            onSelectObject={selectFloorplanObject}
            onSelectConnection={selectFloorplanConnection}
            onStartCreate={() => {
              setCreatingRack(true);
              setRackForm(emptyRackForm);
              setObjectForm({ ...emptyObjectForm, width: "120", height: "180" });
            }}
            onCreateConnection={createFloorplanConnection}
            onCancelCreate={() => {
              setCreatingRack(false);
              if (selectedRack) setRackForm(rackToForm(selectedRack));
            }}
          />
        ) : (
        <section className="flex min-w-0 flex-1 flex-col overflow-auto p-6 pb-24">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div>
          )}

          <div className="grid gap-4 xl:grid-cols-5">
            <Metric icon={Building2} label="Sites" value={overview.summary.sites} detail={`${overview.summary.racks} racks`} />
            <Metric icon={Server} label="Assets" value={overview.summary.assets} detail="physical + CI linked" />
            <Metric icon={Zap} label="Power" value={`${overview.summary.powerUtilization}%`} detail={`${overview.summary.usedKw}/${overview.summary.totalCapacityKw} kW`} />
            <Metric icon={AlertTriangle} label="Critical Events" value={overview.summary.openCriticalEvents} detail={`${overview.summary.openEvents} open total`} />
            <Metric icon={Activity} label="Avg Risk" value={overview.summary.avgRisk} detail="rack health score" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="rounded-lg border border-gray-800 bg-gray-900">
              <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                <div>
                  <h2 className="font-medium text-gray-100">Facility Map</h2>
                  <p className="text-sm text-gray-500">Operational rack view with capacity and event overlays</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> power</span>
                  <span className="flex items-center gap-1"><Thermometer className="h-3 w-3" /> thermal</span>
                  <span className="flex items-center gap-1"><Cable className="h-3 w-3" /> connectivity</span>
                </div>
              </div>
              <div className="grid gap-4 p-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
                {overview.racks.map((rack) => (
                  <button
                    key={rack.id}
                    type="button"
                    onClick={() => selectRack(rack.id)}
                    className={`rounded-lg border p-4 text-left transition ${
                      rack.id === selectedRackId ? "border-indigo-400 bg-indigo-500/10" : "border-gray-800 bg-gray-950 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-lg font-semibold text-gray-100">{rack.name}</div>
                        <div className="text-xs text-gray-500">{rack.site_name} / {rack.room_name}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        rack.status === "critical" ? "bg-red-500/10 text-red-200" :
                        rack.status === "warning" ? "bg-amber-500/10 text-amber-200" :
                        "bg-emerald-500/10 text-emerald-200"
                      }`}>
                        {rack.status}
                      </span>
                    </div>
                    <div className="mt-4 space-y-3">
                      <Bar label="RU" value={rack.ru_utilization} />
                      <Bar label="Power" value={rack.power_utilization} />
                      <Bar label="Weight" value={rack.weight_utilization} />
                    </div>
                    <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
                      <span>{rack.redundancy}</span>
                      <span>Risk {rack.risk_score}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-900">
              <div className="border-b border-gray-800 px-4 py-3">
                <h2 className="font-medium text-gray-100">AI Operations</h2>
                <p className="text-sm text-gray-500">Planned automations for the IT Visibility package</p>
              </div>
              <div className="space-y-3 p-4">
                {[
                  ["Plan install", "Find safe rack, RU, power, and network placement."],
                  ["Simulate failure", "Explain impact of PDU, UPS, CRAC, rack, or circuit loss."],
                  ["Ingest evidence", "Normalize spreadsheets, exports, photos, and event streams."],
                  ["Correlate story", "Turn facility events into one operational narrative."],
                ].map(([title, body], index) => (
                  <button
                    key={title}
                    type="button"
                    onClick={index === 0 ? planInstall : undefined}
                    disabled={index !== 0 || actionLoading === "plan"}
                    className="rounded-lg border border-gray-800 bg-gray-950 p-3 text-left transition enabled:hover:border-indigo-500/60 disabled:cursor-default"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                      <Sparkles className="h-4 w-4 text-indigo-300" />
                      {title}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-gray-500">{body}</div>
                    {index === 0 && plan && (
                      <div className="mt-2 rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">
                        Recommended rack: {plan.recommendation?.rack?.name || "none"}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <RackDetail
              rack={selectedRack}
              assets={selectedRackAssets}
              events={selectedRackEvents}
              onReserve={reserveRackSlot}
              onCreateEvent={createRackEvent}
              actionLoading={actionLoading}
            />
            <EventStoryboard events={overview.events} />
          </div>
        </section>
        )}
      </main>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: any; label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
        <Icon className="h-4 w-4 text-indigo-300" />
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-gray-100">{value}</div>
      <div className="mt-1 text-sm text-gray-500">{detail}</div>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const tone = value >= 85 ? "bg-red-400" : value >= 70 ? "bg-amber-400" : "bg-emerald-400";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
        <div className={`h-full ${tone}`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
    </div>
  );
}

function FloorplanWorkspace({
  overview,
  selectedRack,
  selectedObject,
  selectedConnection,
  selectedRackId,
  savingObjectId,
  rackForm,
  objectForm,
  connectionForm,
  creatingRack,
  actionLoading,
  onRackFormChange,
  onObjectFormChange,
  onConnectionFormChange,
  onCreateRack,
  onUpdateRack,
  onCreateObject,
  onUpdateObject,
  onDeleteObject,
  onUpdateConnection,
  onDeleteConnection,
  onMoveObject,
  onSelectObject,
  onSelectConnection,
  onStartCreate,
  onCreateConnection,
  onCancelCreate,
}: {
  overview: Overview;
  selectedRack: any;
  selectedObject: any | null;
  selectedConnection: any | null;
  selectedRackId: string;
  savingObjectId: string | null;
  rackForm: typeof emptyRackForm;
  objectForm: typeof emptyObjectForm;
  connectionForm: typeof emptyConnectionForm;
  creatingRack: boolean;
  actionLoading: string | null;
  onRackFormChange: (patch: Partial<typeof emptyRackForm>) => void;
  onObjectFormChange: (patch: Partial<typeof emptyObjectForm>) => void;
  onConnectionFormChange: (patch: Partial<typeof emptyConnectionForm>) => void;
  onCreateRack: () => void;
  onUpdateRack: () => void;
  onCreateObject: (item: (typeof floorplanPalette)[number]) => void;
  onUpdateObject: () => void;
  onDeleteObject: () => void;
  onUpdateConnection: () => void;
  onDeleteConnection: () => void;
  onMoveObject: (objectId: string, x: number, y: number) => void;
  onSelectObject: (object: any) => void;
  onSelectConnection: (connection: any) => void;
  onStartCreate: () => void;
  onCreateConnection: (connection: Connection) => void;
  onCancelCreate: () => void;
}) {
  const inspectingRack = selectedObject?.object_type === "rack" ? selectedRack : null;
  return (
    <section className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_340px] overflow-hidden bg-gray-950">
      <aside className="min-h-0 overflow-auto border-r border-gray-800 bg-gray-950 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Floorplan Objects</h2>
            <p className="mt-1 text-xs text-gray-500">{overview.floorplan?.name || "No floorplan"}</p>
          </div>
          <button
            type="button"
            onClick={onStartCreate}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
            title="Create rack"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900 p-3" data-testid="dcim-object-palette">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Palette</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {floorplanPalette.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => onCreateObject(item)}
                  disabled={actionLoading === `create-object:${item.type}`}
                  className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-gray-800 bg-gray-950 p-2 text-center text-xs text-gray-300 transition hover:border-indigo-500/60 hover:text-white disabled:opacity-50"
                >
                  <Icon className="h-4 w-4 text-indigo-300" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {(overview.floorplan?.objects || []).map((object: any) => {
            const rack = object.object_type === "rack" ? overview.racks.find((candidate) => candidate.id === object.object_id) : null;
            const active = selectedObject?.id === object.id;
            return (
              <button
                key={object.id}
                type="button"
                onClick={() => onSelectObject(object)}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  active ? "border-indigo-400 bg-indigo-500/10" : "border-gray-800 bg-gray-900 hover:border-gray-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-medium text-gray-100">{object.label}</div>
                  <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] text-gray-400">{object.object_type}</span>
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {rack ? `${rack.ru_used}/${rack.ru_total} RU · ${rack.power_used_kw}/${rack.power_capacity_kw} kW` : `${Math.round(object.x)}, ${Math.round(object.y)}`}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex min-w-0 min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Grid3X3 className="h-4 w-4 text-indigo-300" />
            Drag objects to maintain the physical layout. Positions save on release.
          </div>
          <div className="text-xs text-gray-500">{savingObjectId ? "Saving..." : `${overview.floorplan?.objects?.length || 0} objects`}</div>
        </div>
        <div className="min-h-0 flex-1 p-5">
          <FloorplanCanvas
            floorplan={overview.floorplan}
            racks={overview.racks}
            events={overview.events}
            selectedRackId={selectedRackId}
            selectedObjectId={selectedObject?.id || ""}
            selectedConnectionId={selectedConnection?.id || ""}
            onSelectObject={onSelectObject}
            onSelectConnection={onSelectConnection}
            onMoveObject={onMoveObject}
            onCreateConnection={onCreateConnection}
          />
        </div>
      </div>

      <aside className="min-h-0 overflow-auto border-l border-gray-800 bg-gray-950 p-4 pb-24">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">{creatingRack ? "Create Rack" : selectedConnection ? "Connection Inspector" : "Object Inspector"}</h2>
            <p className="mt-1 text-xs text-gray-500">{creatingRack ? "Add a rack to the active floorplan." : selectedConnection ? "Edit cabling, power, and cooling relationships." : inspectingRack ? inspectingRack.name : selectedObject ? selectedObject.label : "Select an object or connection."}</p>
          </div>
          {creatingRack && (
            <button type="button" onClick={onCancelCreate} className="rounded-lg border border-gray-800 p-2 text-gray-400 hover:bg-gray-900" title="Cancel">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {selectedConnection ? (
          <ConnectionEditor
            form={connectionForm}
            saving={actionLoading === "update-connection" || actionLoading === "delete-connection"}
            connection={selectedConnection}
            onChange={onConnectionFormChange}
            onSave={onUpdateConnection}
            onDelete={onDeleteConnection}
          />
        ) : (creatingRack || inspectingRack) ? (
          <>
            <RackEditor
              form={rackForm}
              creating={creatingRack}
              saving={actionLoading === "create-rack" || actionLoading === "update-rack"}
              selectedRack={inspectingRack}
              onChange={onRackFormChange}
              onSubmit={creatingRack ? onCreateRack : onUpdateRack}
            />
            {selectedObject && !creatingRack && (
              <ObjectEditor
                form={objectForm}
                object={selectedObject}
                saving={actionLoading === "update-object" || actionLoading === "delete-object"}
                onChange={onObjectFormChange}
                onSave={onUpdateObject}
                onDelete={onDeleteObject}
              />
            )}
          </>
        ) : selectedObject ? (
          <ObjectEditor
            form={objectForm}
            object={selectedObject}
            saving={actionLoading === "update-object" || actionLoading === "delete-object"}
            onChange={onObjectFormChange}
            onSave={onUpdateObject}
            onDelete={onDeleteObject}
          />
        ) : (
          <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
            Select an object from the canvas or object list to inspect and edit it.
          </div>
        )}
      </aside>
    </section>
  );
}

function RackEditor({
  form,
  creating,
  saving,
  selectedRack,
  onChange,
  onSubmit,
}: {
  form: typeof emptyRackForm;
  creating: boolean;
  saving: boolean;
  selectedRack: any;
  onChange: (patch: Partial<typeof emptyRackForm>) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-4 space-y-4">
      <label className="block text-xs font-medium text-gray-400">
        Rack name
        <input value={form.name} onChange={(event) => onChange({ name: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-400">
          Row
          <input value={form.rowLabel} onChange={(event) => onChange({ rowLabel: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </label>
        <label className="block text-xs font-medium text-gray-400">
          Position
          <input value={form.positionLabel} onChange={(event) => onChange({ positionLabel: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-400">
          RU total
          <input type="number" min="1" value={form.ruTotal} onChange={(event) => onChange({ ruTotal: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </label>
        <label className="block text-xs font-medium text-gray-400">
          Power kW
          <input type="number" min="0" step="0.1" value={form.powerCapacityKw} onChange={(event) => onChange({ powerCapacityKw: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </label>
      </div>
      <label className="block text-xs font-medium text-gray-400">
        Weight capacity kg
        <input type="number" min="0" value={form.weightCapacityKg} onChange={(event) => onChange({ weightCapacityKg: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-400">
          Redundancy
          <select value={form.redundancy} onChange={(event) => onChange({ redundancy: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500">
            {["A/B", "N", "N+1", "2N"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-400">
          Status
          <select value={form.status} onChange={(event) => onChange({ status: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500">
            {["operational", "warning", "critical", "planned"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      {!creating && selectedRack && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500">
          Current use: {selectedRack.ru_used}/{selectedRack.ru_total} RU, {selectedRack.power_used_kw}/{selectedRack.power_capacity_kw} kW, risk {selectedRack.risk_score}
        </div>
      )}
      <button
        type="button"
        onClick={onSubmit}
        disabled={saving || !form.name.trim()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : creating ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {creating ? "Create Rack" : "Save Rack"}
      </button>
    </div>
  );
}

function ObjectEditor({
  form,
  object,
  saving,
  onChange,
  onSave,
  onDelete,
}: {
  form: typeof emptyObjectForm;
  object: any;
  saving: boolean;
  onChange: (patch: Partial<typeof emptyObjectForm>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mt-4 space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-4" data-testid="dcim-object-editor">
      <div>
        <div className="text-sm font-medium text-gray-100">Footprint</div>
        <div className="mt-1 text-xs text-gray-500">{object.object_type} · floorplan object</div>
      </div>
      <label className="block text-xs font-medium text-gray-400">
        Label
        <input value={form.label} onChange={(event) => onChange({ label: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-400">
          Width
          <input type="number" min="20" value={form.width} onChange={(event) => onChange({ width: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </label>
        <label className="block text-xs font-medium text-gray-400">
          Height
          <input type="number" min="20" value={form.height} onChange={(event) => onChange({ height: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
        </label>
      </div>
      <label className="block text-xs font-medium text-gray-400">
        Rotation
        <input type="number" step="15" value={form.rotation} onChange={(event) => onChange({ rotation: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !form.label.trim()}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Remove
        </button>
      </div>
    </div>
  );
}

function ConnectionEditor({
  form,
  connection,
  saving,
  onChange,
  onSave,
  onDelete,
}: {
  form: typeof emptyConnectionForm;
  connection: any;
  saving: boolean;
  onChange: (patch: Partial<typeof emptyConnectionForm>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="mt-4 space-y-4 rounded-lg border border-gray-800 bg-gray-900 p-4" data-testid="dcim-connection-editor">
      <div>
        <div className="text-sm font-medium text-gray-100">{connection.source_label || "Source"} to {connection.target_label || "Target"}</div>
        <div className="mt-1 text-xs text-gray-500">Persisted floorplan relationship</div>
      </div>
      <label className="block text-xs font-medium text-gray-400">
        Label
        <input value={form.label} onChange={(event) => onChange({ label: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-gray-400">
          Type
          <select value={form.connectionType} onChange={(event) => onChange({ connectionType: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500">
            {["network", "power", "cooling", "monitoring"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-gray-400">
          Status
          <select value={form.status} onChange={(event) => onChange({ status: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-indigo-500">
            {["operational", "warning", "critical", "planned"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={saving}
          className="flex items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 py-2 text-sm font-medium text-red-200 hover:bg-red-500/10 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

function FloorplanCanvas({
  floorplan,
  racks,
  events,
  selectedRackId,
  selectedObjectId,
  selectedConnectionId,
  onSelectObject,
  onSelectConnection,
  onMoveObject,
  onCreateConnection,
}: {
  floorplan: any | null;
  racks: any[];
  events: any[];
  selectedRackId: string;
  selectedObjectId: string;
  selectedConnectionId: string;
  onSelectObject: (object: any) => void;
  onSelectConnection: (connection: any) => void;
  onMoveObject: (objectId: string, x: number, y: number) => void;
  onCreateConnection: (connection: Connection) => void;
}) {
  const rackById = useMemo(() => new Map(racks.map((rack) => [rack.id, rack])), [racks]);
  const eventRackIds = useMemo(() => new Set(events.map((event) => event.rack_id).filter(Boolean)), [events]);

  if (!floorplan) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-sm text-gray-500">
        No 2D floorplan has been registered for this room.
      </div>
    );
  }

  const objects = floorplan.objects || [];
  const nodes = useMemo<Node<FloorplanNodeData>[]>(() => objects.map((object: any) => {
    const rack = object.object_type === "rack" ? rackById.get(object.object_id) : undefined;
    return {
      id: object.id,
      type: object.object_type === "rack" ? "rack" : "facility",
      position: { x: Number(object.x || 0), y: Number(object.y || 0) },
      data: {
        object,
        rack,
        hasEvent: eventRackIds.has(object.object_id),
      },
      selected: object.id === selectedObjectId || object.object_id === selectedRackId,
      draggable: true,
      width: Number(object.width || 120),
      height: Number(object.height || 80),
      style: {
        width: Number(object.width || 120),
        height: Number(object.height || 80),
      },
    };
  }), [eventRackIds, objects, rackById, selectedObjectId, selectedRackId]);
  const edges = useMemo<Edge[]>(() => (floorplan.connections || []).map((connection: any) => {
    const type = connection.connection_type || "network";
    const color = type === "power" ? "#facc15" : type === "cooling" ? "#22d3ee" : type === "monitoring" ? "#34d399" : "#818cf8";
    const selected = connection.id === selectedConnectionId;
    return {
      id: connection.id,
      source: connection.source_object_id,
      target: connection.target_object_id,
      sourceHandle: type === "power" ? "power-out" : type === "cooling" ? "cooling-out" : "network-out",
      targetHandle: type === "power" ? "power-in" : type === "cooling" ? "cooling-in" : "network-in",
      type: "smoothstep",
      label: connection.label || type,
      animated: connection.status === "warning" || connection.status === "critical",
      markerEnd: { type: MarkerType.ArrowClosed, color },
      style: { stroke: color, strokeWidth: selected ? 4 : type === "power" ? 3 : 2 },
      labelStyle: { fill: "#cbd5e1", fontSize: 11 },
      labelBgStyle: { fill: "#020617", fillOpacity: 0.8 },
    };
  }), [floorplan.connections, selectedConnectionId]);

  const onNodeDragStop = useCallback((_event: MouseEvent, node: Node) => {
    onMoveObject(node.id, node.position.x, node.position.y);
  }, [onMoveObject]);

  const nodeExtent: [[number, number], [number, number]] = [[0, 0], [Number(floorplan.width || 1200), Number(floorplan.height || 720)]];

  return (
    <div className="h-full min-h-[520px] overflow-hidden rounded-lg border border-gray-800 bg-gray-900">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_event, node) => onSelectObject((node.data as FloorplanNodeData).object)}
        onEdgeClick={(_event, edge) => {
          const connection = (floorplan.connections || []).find((item: any) => item.id === edge.id);
          if (connection) onSelectConnection(connection);
        }}
        onNodeDragStop={onNodeDragStop}
        onConnect={onCreateConnection}
        connectionLineStyle={connectionLineStyle}
        nodeExtent={nodeExtent}
        translateExtent={nodeExtent}
        snapToGrid
        snapGrid={[20, 20]}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.4}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#334155" gap={20} />
        <Controls position="bottom-right" className="!border !border-gray-700 !bg-gray-900 !shadow-xl" showInteractive={false} />
        <div className="pointer-events-none absolute left-[8%] right-[8%] top-[44%] z-0 h-[12%] rounded border border-sky-500/20 bg-sky-500/5">
          <span className="absolute left-3 top-2 text-xs text-sky-200/70">Cold aisle</span>
        </div>
      </ReactFlow>
    </div>
  );
}

function RackFlowNode({ data, selected }: NodeProps<FloorplanNodeData>) {
  const rack = data.rack;
  const status = rack?.status || "operational";
  const tone = status === "critical"
    ? "border-red-300 bg-red-600/85"
    : status === "warning"
      ? "border-amber-200 bg-amber-500/85"
      : "border-emerald-200 bg-emerald-600/85";
  return (
    <div className={`relative h-full w-full rounded border p-2 text-white shadow-xl ${tone} ${selected ? "ring-2 ring-indigo-300" : ""}`} style={{ transform: `rotate(${Number(data.object.rotation || 0)}deg)` }} data-testid={`dcim-floorplan-object-${data.object.label}`}>
      <Handle id="power-in" type="target" position={Position.Left} className="!h-3 !w-3 !border-yellow-200 !bg-yellow-400" />
      <Handle id="network-in" type="target" position={Position.Top} className="!h-3 !w-3 !border-indigo-200 !bg-indigo-400" />
      <Handle id="network-out" type="source" position={Position.Right} className="!h-3 !w-3 !border-indigo-200 !bg-indigo-400" />
      <Handle id="power-out" type="source" position={Position.Bottom} className="!h-3 !w-3 !border-yellow-200 !bg-yellow-400" />
      <div className="flex items-center justify-between gap-2 text-xs font-semibold">
        <span className="truncate">{data.object.label}</span>
        {data.hasEvent && <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
      </div>
      {rack && (
        <div className="mt-2 space-y-1 text-[11px] leading-4 text-white/85">
          <div>RU {rack.ru_used}/{rack.ru_total}</div>
          <div>Power {rack.power_used_kw}/{rack.power_capacity_kw} kW</div>
          <div>Risk {rack.risk_score}</div>
        </div>
      )}
    </div>
  );
}

function FacilityFlowNode({ data, selected }: NodeProps<FloorplanNodeData>) {
  const type = data.object.object_type;
  const tone = type === "cooling"
    ? "border-cyan-200 bg-cyan-600/80"
    : type === "power"
      ? "border-yellow-200 bg-yellow-600/80"
      : "border-slate-300 bg-slate-700/80";
  return (
    <div className={`relative flex h-full w-full flex-col justify-center rounded border p-3 text-white shadow-xl ${tone} ${selected ? "ring-2 ring-indigo-300" : ""}`} style={{ transform: `rotate(${Number(data.object.rotation || 0)}deg)` }} data-testid={`dcim-floorplan-object-${data.object.label}`}>
      <Handle id={`${type}-out`} type="source" position={Position.Right} className="!h-3 !w-3 !border-white !bg-white" />
      <Handle id={`${type}-in`} type="target" position={Position.Left} className="!h-3 !w-3 !border-white !bg-white" />
      <div className="text-xs font-semibold">{data.object.label}</div>
      <div className="mt-1 text-[11px] uppercase tracking-wide text-white/70">{type}</div>
    </div>
  );
}

function RackDetail({
  rack,
  assets,
  events,
  onReserve,
  onCreateEvent,
  actionLoading,
}: {
  rack: any;
  assets: any[];
  events: any[];
  onReserve: () => void;
  onCreateEvent: () => void;
  actionLoading: string | null;
}) {
  if (!rack) return null;
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900">
      <div className="flex items-center justify-between gap-4 border-b border-gray-800 px-4 py-3">
        <div>
          <h2 className="font-medium text-gray-100">Rack Intelligence: {rack.name}</h2>
          <p className="text-sm text-gray-500">RU occupancy, linked CIs, and local facility events</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onReserve}
            disabled={actionLoading === "reserve"}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {actionLoading === "reserve" ? "Reserving..." : "Reserve 2RU"}
          </button>
          <button
            type="button"
            onClick={onCreateEvent}
            disabled={actionLoading === "event"}
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-gray-800 disabled:opacity-50"
          >
            {actionLoading === "event" ? "Creating..." : "Create Event"}
          </button>
        </div>
      </div>
      <div className="grid gap-4 p-4 md:grid-cols-[128px_minmax(0,1fr)]">
        <div className="grid h-[360px] grid-rows-[repeat(42,minmax(0,1fr))] gap-1 overflow-hidden rounded-lg border border-gray-800 bg-gray-950 p-2">
          {Array.from({ length: 42 }).map((_, index) => {
            const ru = 42 - index;
            const asset = assets.find((item) => ru >= Number(item.ru_start || 0) && ru < Number(item.ru_start || 0) + Number(item.ru_height || 1));
            return (
              <div
                key={ru}
                className={`flex min-h-0 items-center justify-center rounded text-[10px] leading-none ${
                  asset ? "bg-indigo-500/40 text-indigo-100" : "bg-gray-800/60 text-gray-600"
                }`}
              >
                {asset ? asset.name.slice(0, 3).toUpperCase() : ru}
              </div>
            );
          })}
        </div>
        <div className="space-y-3">
          {assets.map((asset) => (
            <div key={asset.id} className="rounded-lg border border-gray-800 bg-gray-950 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
                  <Package className="h-4 w-4 text-indigo-300" />
                  {asset.name}
                </div>
                <span className="text-xs text-gray-500">RU {asset.ru_start}-{Number(asset.ru_start || 0) + Number(asset.ru_height || 1) - 1}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-500">
                <span>{asset.vendor || "Unknown"}</span>
                <span>{asset.model || asset.asset_type}</span>
                <span>{asset.power_draw_kw} kW</span>
              </div>
            </div>
          ))}
          {!assets.length && <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">No modeled assets in this rack.</div>}
          {events.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-100">
              {events.length} open event{events.length === 1 ? "" : "s"} affecting this rack.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventStoryboard({ events }: { events: any[] }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900">
      <div className="border-b border-gray-800 px-4 py-3">
        <h2 className="font-medium text-gray-100">Event Storyboard</h2>
        <p className="text-sm text-gray-500">Topology-aware facility events ready for correlation</p>
      </div>
      <div className="space-y-3 p-4">
        {events.map((event) => (
          <div key={event.id} className={`rounded-lg border p-4 ${severityStyles[event.severity] || severityStyles.info}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Activity className="h-4 w-4" />
                  {event.title}
                </div>
                <div className="mt-1 text-sm opacity-80">{event.description}</div>
              </div>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-xs">{event.severity}</span>
            </div>
            {event.ai_summary && (
              <div className="mt-3 flex gap-2 rounded-lg bg-black/20 p-3 text-sm">
                <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{event.ai_summary}</span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 text-xs opacity-75">
              {event.site_name && <span>{event.site_name}</span>}
              {event.room_name && <span>{event.room_name}</span>}
              {event.rack_name && <span>{event.rack_name}</span>}
            </div>
          </div>
        ))}
        {!events.length && <div className="rounded-lg border border-gray-800 bg-gray-950 p-4 text-sm text-gray-500">No open DCIM events.</div>}
      </div>
    </div>
  );
}
