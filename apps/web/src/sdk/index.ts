export * from "./types";
import type { RegistryEntry, AppManifest } from "./types";

const DB_NAME = "specora_platform";
const DB_VERSION = 1;
const STORE_NAME = "specora_apps";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

export async function getRegistry(): Promise<RegistryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(sortRegistry(req.result as RegistryEntry[]));
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function getRawRegistry(): Promise<RegistryEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(sortRegistry(req.result as RegistryEntry[]));
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

function sortRegistry(apps: RegistryEntry[]): RegistryEntry[] {
  return [...apps].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function getApiBase() {
  return process.env.NEXT_PUBLIC_API_URL?.replace("/graphql", "") || "http://localhost:4000";
}

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("specora_token");
}

export async function syncServerRegistry(): Promise<RegistryEntry[]> {
  const token = getToken();
  if (!token) {
    await seedBuiltInApps();
    return getRegistry();
  }

  const response = await fetch(`${getApiBase()}/api/apps/registry`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    await seedBuiltInApps();
    return getRegistry();
  }

  const data = await response.json();
  const apps = (data.apps || []) as RegistryEntry[];
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const clearReq = store.clear();
    clearReq.onsuccess = () => {
      for (const app of apps) store.put(app);
    };
    clearReq.onerror = () => reject(clearReq.error);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
  return sortRegistry(apps);
}

export async function installApp(manifest: AppManifest): Promise<RegistryEntry> {
  const db = await openDB();
  const entry: RegistryEntry = {
    ...manifest,
    installKey: `ext_${crypto.randomUUID()}`,
    source: "external",
    installedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(entry);
    req.onsuccess = () => resolve(entry);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function getAvailableRegistry(): Promise<RegistryEntry[]> {
  const token = getToken();
  if (!token) {
    await seedBuiltInApps();
    return getRawRegistry();
  }
  const response = await fetch(`${getApiBase()}/api/apps/catalog`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) {
    await seedBuiltInApps();
    return getRawRegistry();
  }
  const data = await response.json();
  return sortRegistry((data.apps || []) as RegistryEntry[]);
}

export async function reinstallOptionalApp(id: string): Promise<void> {
  const token = getToken();
  if (!token) return seedBuiltInApps();
  const response = await fetch(`${getApiBase()}/api/apps/${id}/install`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("App could not be installed");
  await syncServerRegistry();
}

export async function uninstallApp(id: string, clearData: boolean = false): Promise<void> {
  const token = getToken();
  if (token) {
    const response = await fetch(`${getApiBase()}/api/apps/${id}/uninstall`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ clearData, dataRetentionPolicy: clearData ? "purge" : "retain" }),
    });
    if (!response.ok) throw new Error("App could not be uninstalled");
    await syncServerRegistry();
    return;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const entry = getReq.result as RegistryEntry | undefined;
      if (entry?.clearDataOnUninstall && clearData) {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(`specora_app_${id}_`)) keysToRemove.push(key);
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      }
      const delReq = store.delete(id);
      delReq.onsuccess = () => resolve();
      delReq.onerror = () => reject(delReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => db.close();
  });
}

export async function seedBuiltInApps(): Promise<void> {
  const existing = await getRegistry();
  const existingIds = new Set(existing.map((e) => e.id));

  const builtIns: RegistryEntry[] = [
    {
      id: "service-map",
      name: "Service Map",
      description: "Visualize service dependencies with interactive graph layouts.",
      icon: "Map",
      version: "1.0.0",
      permissions: ["read:cmdb", "read:relationships"],
      defaultMode: "canvas",
      installKey: "builtin_service-map",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "service-map.show",
          label: "Show service map",
          description: "Visualize dependencies for a service",
          prompt: "Show me the service map",
          icon: "Map",
        },
      ],
    },
    {
      id: "cmdb-explorer",
      name: "CMDB Explorer",
      description: "Search, filter, and inspect Configuration Items in your CMDB.",
      icon: "Database",
      version: "1.0.0",
      permissions: ["read:cmdb", "read:relationships"],
      defaultMode: "canvas",
      installKey: "builtin_cmdb-explorer",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "cmdb.investigate-ci",
          label: "Investigate CI",
          description: "Find a CI, summarize its details, and open it in CMDB Explorer",
          prompt: "Find and investigate a configuration item",
          icon: "Database",
        },
        {
          id: "cmdb.browse",
          label: "Browse CMDB",
          description: "Open the CMDB Explorer workspace",
          prompt: "Open CMDB Explorer",
          icon: "Search",
        },
        {
          id: "cmdb.find-risk",
          label: "Find risky CIs",
          description: "Find low-health, stale, or incomplete CIs",
          prompt: "Find risky CIs in the CMDB",
          icon: "AlertTriangle",
        },
        {
          id: "cmdb.find-orphans",
          label: "Find orphaned CIs",
          description: "Find CIs with missing relationship context",
          prompt: "Find orphaned CIs in the CMDB",
          icon: "Unlink",
        },
        {
          id: "cmdb.find-path",
          label: "Find dependency path",
          description: "Find the graph path between two CIs",
          prompt: "Find the dependency path between two CIs",
          icon: "Route",
        },
      ],
    },
    {
      id: "settings",
      name: "Settings",
      description: "Manage profile, theme, and platform preferences.",
      icon: "Settings",
      version: "1.0.0",
      permissions: ["read:profile"],
      defaultMode: "window",
      installKey: "builtin_settings",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
    },
    {
      id: "discovery",
      name: "Discovery",
      description: "Upload and ingest infrastructure data into the graph.",
      icon: "Upload",
      version: "1.0.0",
      permissions: ["read:discovery", "write:discovery"],
      defaultMode: "canvas",
      installKey: "builtin_discovery",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "discovery.status",
          label: "Discovery status",
          description: "Check the latest discovery job results",
          prompt: "What is the status of the latest discovery job?",
          icon: "Upload",
        },
      ],
    },
    {
      id: "arc",
      name: "Specora Arc",
      description: "Discover and manage apps in the Specora ecosystem.",
      icon: "Compass",
      version: "1.0.0",
      permissions: ["read:profile"],
      defaultMode: "window",
      installKey: "builtin_arc",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
    },
    {
      id: "change-manager",
      name: "Change Manager",
      description: "Create and manage change requests with approval workflows.",
      icon: "GitPullRequest",
      version: "1.0.0",
      permissions: ["itsm:change:read", "itsm:change:write"],
      defaultMode: "canvas",
      installKey: "builtin_change-manager",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      adminPanels: [
        {
          id: "change-manager-state-machine",
          name: "Change State Machine",
          icon: "GitBranch",
          permissions: ["system-properties:write"],
        },
      ],
      chatTools: [
        {
          name: "create_rfc",
          description: `Create a change request for a CI.

IMPORTANT: Before calling this tool, collect ALL required information from the user through conversation, ONE QUESTION AT A TIME:
1. Ask which CI they want to change. Use search_cis if they don't know the ID.
2. Use get_affected_cis to discover dependencies (up to 3 hops). Ask which should be included.
3. Collect the title.
4. Collect the description (optional).
5. Collect planned start date (YYYY-MM-DD) and planned start time (HH:MM, optional).
6. Collect planned end date (YYYY-MM-DD) and planned end time (HH:MM, optional).

Only call this tool once all required information is gathered.`,
          parameters: {
            type: "object",
            properties: {
              ciId: { type: "string", description: "ID of the CI to change" },
              title: { type: "string", description: "RFC title" },
              description: { type: "string", description: "Detailed description" },
              plannedStartDate: { type: "string", description: "Planned start date in YYYY-MM-DD format" },
              plannedStartTime: { type: "string", description: "Planned start time in HH:MM format (optional, default 00:00)" },
              plannedEndDate: { type: "string", description: "Planned end date in YYYY-MM-DD format (optional)" },
              plannedEndTime: { type: "string", description: "Planned end time in HH:MM format (optional, default 00:00)" },
              affectedCiIds: { type: "array", items: { type: "string" }, description: "IDs of affected/dependent CIs to include" },
            },
            required: ["ciId", "title"],
          },
        },
        {
          name: "approve_rfc",
          description: "Approve a pending change request",
          parameters: {
            type: "object",
            properties: {
              rfcId: { type: "string", description: "UUID of the RFC" },
            },
            required: ["rfcId"],
          },
        },
        {
          name: "list_rfcs",
          description: "List change requests, optionally filtered by status or CI",
          parameters: {
            type: "object",
            properties: {
              status: { type: "string", description: "draft, pending_approval, approved, implemented, closed" },
              ciId: { type: "string" },
            },
          },
        },
        {
          name: "get_rfc",
          description: "Get details of a specific change request",
          parameters: {
            type: "object",
            properties: {
              rfcId: { type: "string", description: "UUID of the RFC" },
            },
            required: ["rfcId"],
          },
        },
      ],
      chatCapabilities: [
        {
          id: "change-manager.create",
          label: "Create change request",
          description: "Start a new RFC with step-by-step guidance",
          prompt: "I want to create a new change request",
          icon: "GitPullRequest",
        },
        {
          id: "change-manager.list",
          label: "List pending changes",
          description: "Show all change requests awaiting action",
          prompt: "Show me all pending change requests",
          icon: "List",
        },
      ],
      events: ["ci.created"],
    },
    {
      id: "incident-manager",
      name: "Incident Command Center",
      description: "AI-first incident triage, command, remediation, and learning workflows.",
      icon: "Siren",
      version: "1.0.0",
      permissions: ["itsm:incident:read", "itsm:incident:write"],
      defaultMode: "canvas",
      installKey: "builtin_incident-manager",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      chatTools: [
        {
          name: "create_incident",
          description: "Create an incident from a user report, alert, pipeline, monitor, or external signal.",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              severity: { type: "string", description: "critical, high, medium, low" },
              ciId: { type: "string" },
              service: { type: "string" },
              source: { type: "string" },
              externalRef: { type: "string" },
              affectedCiIds: { type: "array", items: { type: "string" } },
            },
            required: ["title"],
          },
        },
        {
          name: "triage_incident",
          description: "Correlate and triage an incident using CMDB, health, and change context.",
          parameters: {
            type: "object",
            properties: {
              incidentId: { type: "string" },
            },
            required: ["incidentId"],
          },
        },
        {
          name: "recommend_remediation",
          description: "Propose safe remediation actions for an active incident.",
          parameters: {
            type: "object",
            properties: {
              incidentId: { type: "string" },
            },
            required: ["incidentId"],
          },
        },
      ],
      chatCapabilities: [
        {
          id: "incident-manager.triage",
          label: "Triage incident",
          description: "Create, correlate, and triage an incident with AI context",
          prompt: "Triage a new incident",
          icon: "Siren",
        },
        {
          id: "incident-manager.command",
          label: "Open command center",
          description: "Open active incidents and major incident command",
          prompt: "Open Incident Command Center",
          icon: "Activity",
        },
        {
          id: "incident-manager.remediate",
          label: "Recommend remediation",
          description: "Suggest safe remediation actions for an active incident",
          prompt: "Recommend remediation for an incident",
          icon: "Bot",
        },
      ],
      events: ["incident.created", "incident.triaged", "incident.status_changed"],
    },
    {
      id: "knowledge-core",
      name: "Knowledge Core",
      description: "AI-governed knowledge graph for answers, runbooks, stewardship, and operational learning.",
      icon: "Brain",
      version: "1.0.0",
      permissions: ["itsm:knowledge:read", "itsm:knowledge:write"],
      defaultMode: "canvas",
      installKey: "builtin_knowledge-core",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      chatTools: [
        {
          name: "answer",
          description: "Answer a question using governed knowledge with citations and confidence.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
              audience: { type: "string" },
              ciId: { type: "string" },
              service: { type: "string" },
            },
            required: ["query"],
          },
        },
        {
          name: "draft_from_record",
          description: "Draft knowledge from an incident, change, chat answer, health finding, or discovery finding.",
          parameters: {
            type: "object",
            properties: {
              sourceType: { type: "string" },
              sourceId: { type: "string" },
              title: { type: "string" },
              notes: { type: "string" },
            },
            required: ["sourceType", "sourceId"],
          },
        },
      ],
      chatCapabilities: [
        {
          id: "knowledge-core.answer",
          label: "Answer from knowledge",
          description: "Answer with governed knowledge, citations, and confidence",
          prompt: "Answer this using Knowledge Core",
          icon: "Brain",
        },
        {
          id: "knowledge-core.stewardship",
          label: "Stewardship queue",
          description: "Review stale, risky, missing, and draft knowledge",
          prompt: "Show the Knowledge Core stewardship queue",
          icon: "Library",
        },
        {
          id: "knowledge-core.draft",
          label: "Draft knowledge",
          description: "Create reusable knowledge from an incident, change, or operational note",
          prompt: "Draft a knowledge article from recent work",
          icon: "Sparkles",
        },
      ],
      events: ["knowledge.created", "knowledge.published", "knowledge.gap_detected", "knowledge.feedback_recorded"],
    },
    {
      id: "prevention-center",
      name: "Prevention Center",
      description: "Reliability prevention engine for recurring incidents, known errors, corrective actions, and measured reduction.",
      icon: "ShieldCheck",
      version: "1.0.0",
      permissions: ["itsm:prevention:read", "itsm:prevention:write"],
      defaultMode: "canvas",
      installKey: "builtin_prevention-center",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "prevention-center.detect",
          label: "Detect prevention work",
          description: "Find recurring incident and reliability patterns worth fixing",
          prompt: "Detect prevention candidates",
          icon: "ShieldCheck",
        },
        {
          id: "prevention-center.actions",
          label: "Propose corrective actions",
          description: "Create known-error, health, change, and automation prevention work",
          prompt: "Propose corrective actions for prevention candidates",
          icon: "Target",
        },
      ],
      events: ["prevention.created", "prevention.candidates_detected", "prevention.status_changed"],
    },
    {
      id: "asset-command",
      name: "Asset Command Center",
      description: "AI-first ITAM for hardware custody, software entitlements, contract extraction, reconciliation, and savings.",
      icon: "PackageSearch",
      version: "1.0.0",
      permissions: ["itsm:asset:read", "itsm:asset:write"],
      defaultMode: "canvas",
      installKey: "builtin_asset-command",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "asset-command.reconcile",
          label: "Reconcile SAM",
          description: "Compare software usage against entitlements and surface license risk",
          prompt: "Run SAM reconciliation",
          icon: "Scale",
        },
        {
          id: "asset-command.contract",
          label: "Extract entitlements",
          description: "Create contract and entitlement records from agreement data",
          prompt: "Extract software entitlements from this contract",
          icon: "FileText",
        },
        {
          id: "asset-command.scans",
          label: "Review asset scans",
          description: "Inspect mobile-ready barcode/RFID scan and custody evidence",
          prompt: "Review asset scan exceptions",
          icon: "ScanLine",
        },
      ],
      events: ["asset.created", "asset.contract_ingested", "asset.sam_reconciled", "asset.scanned"],
    },
    {
      id: "discovery-insights",
      name: "Discovery Insights",
      description: "Analyze discovery coverage and suggest next scans.",
      icon: "Radar",
      version: "1.0.0",
      permissions: ["itsm:discovery:read", "read:cmdb"],
      defaultMode: "canvas",
      installKey: "builtin_discovery-insights",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      chatTools: [
        {
          name: "analyze_coverage",
          description: "Analyze a discovery job's coverage against expected CSDMv5 classes",
          parameters: {
            type: "object",
            properties: {
              jobId: { type: "string", description: "UUID of the discovery job" },
            },
            required: ["jobId"],
          },
        },
        {
          name: "suggest_next_scan",
          description: "Suggest the next discovery scan based on coverage gaps",
          parameters: {
            type: "object",
            properties: {
              environment: { type: "string", description: "Optional environment filter" },
            },
          },
        },
      ],
      chatCapabilities: [
        {
          id: "discovery-insights.coverage",
          label: "Discovery coverage",
          description: "Analyze how complete the CMDB discovery is",
          prompt: "Analyze discovery coverage",
          icon: "Radar",
        },
      ],
      events: ["discovery.completed"],
    },
    {
      id: "health-monitor",
      name: "Health Monitor",
      description: "Detect anomalies and monitor CI health scores.",
      icon: "HeartPulse",
      version: "1.0.0",
      permissions: ["itsm:health:read", "itsm:health:write", "read:cmdb", "read:relationships"],
      defaultMode: "canvas",
      installKey: "builtin_health-monitor",
      source: "built-in",
      publisher: "Specora ITSM",
      installedAt: Date.now(),
      chatTools: [
        {
          name: "find_cycles",
          description: "Find circular dependencies in the CMDB graph",
          parameters: {
            type: "object",
            properties: {
              maxDepth: { type: "integer", description: "Maximum path depth to search" },
            },
          },
        },
        {
          name: "find_orphaned",
          description: "Find CIs with zero relationships",
          parameters: {
            type: "object",
            properties: {
              class: { type: "string", description: "Optional CI class filter" },
            },
          },
        },
        {
          name: "find_stale",
          description: "Find CIs not discovered in the last N days",
          parameters: {
            type: "object",
            properties: {
              days: { type: "integer", description: "Days since last discovery (default 30)" },
            },
          },
        },
        {
          name: "score_ci",
          description: "Compute health score for a specific CI",
          parameters: {
            type: "object",
            properties: {
              ciId: { type: "string", description: "ID of the CI" },
            },
            required: ["ciId"],
          },
        },
      ],
      chatCapabilities: [
        {
          id: "health-monitor.orphaned",
          label: "Find orphaned CIs",
          description: "Show CIs with no relationships",
          prompt: "Find orphaned CIs",
          icon: "HeartPulse",
        },
        {
          id: "health-monitor.stale",
          label: "Find stale CIs",
          description: "Show CIs not updated recently",
          prompt: "Find stale CIs",
          icon: "HeartPulse",
        },
      ],
      events: ["ci.updated"],
    },
    {
      id: "it-visibility-dcim",
      name: "DCIM Command Center",
      description: "Premium IT Visibility package app for facility topology, rack intelligence, power/cooling risk, and event correlation.",
      icon: "Network",
      version: "0.1.0",
      permissions: ["it-visibility:read", "it-visibility:write", "it-visibility:operate"],
      defaultMode: "canvas",
      installKey: "package_it-visibility_dcim",
      source: "built-in",
      publisher: "Specora IT Visibility",
      installedAt: Date.now(),
      packageId: "it-visibility",
      packageName: "IT Visibility",
      premium: true,
      entitlementMode: "placeholder",
      bundledWithPlatform: false,
      chatCapabilities: [
        {
          id: "dcim.plan-install",
          label: "Plan rack install",
          description: "Find viable rack placement and power/network constraints",
          prompt: "Plan a data center rack install",
          icon: "Network",
        },
        {
          id: "dcim.failure-impact",
          label: "Simulate facility failure",
          description: "Explain service impact from PDU, UPS, cooling, or rack failure",
          prompt: "Simulate a data center failure impact",
          icon: "Zap",
        },
        {
          id: "dcim.event-story",
          label: "Explain facility events",
          description: "Correlate facility events into an operational story",
          prompt: "Explain current DCIM events",
          icon: "Activity",
        },
      ],
      events: ["dcim.event.ingested", "dcim.capacity.changed", "dcim.risk.detected"],
    },
    {
      id: "audit-log",
      name: "Audit Log",
      description: "View audit trail of all CMDB mutations and changes.",
      icon: "ScrollText",
      version: "1.0.0",
      permissions: ["audit-log:read"],
      defaultMode: "canvas",
      installKey: "builtin_audit-log",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "audit-log.view",
          label: "View audit log",
          description: "Show recent CMDB changes",
          prompt: "Show me the audit log",
          icon: "ScrollText",
        },
      ],
    },
    {
      id: "admin-console",
      name: "Admin Console",
      description: "Govern access, registries, counters, system properties, and app-owned admin panels.",
      icon: "Shield",
      version: "1.0.0",
      permissions: ["rbac:read", "rbac:write", "number-sequences:read", "number-sequences:write", "system-properties:read", "system-properties:write"],
      defaultMode: "canvas",
      installKey: "builtin_admin-console",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
    },
    {
      id: "ci-class-manager",
      name: "CI Class Manager",
      description: "Define CI classes, attributes, and data quality rules.",
      icon: "Layers",
      version: "1.0.0",
      permissions: ["admin:cmdb"],
      defaultMode: "window",
      installKey: "builtin_ci-class-manager",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
    },
    {
      id: "tables",
      name: "Tables",
      description: "Browse and maintain platform tables through RBAC-aware CRUD APIs.",
      icon: "TableProperties",
      version: "1.0.0",
      permissions: ["tables:read", "tables:write"],
      defaultMode: "canvas",
      installKey: "builtin_tables",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
    },
    {
      id: "data-foundations",
      name: "Data Foundations",
      description: "Govern CSDMv5 foundation data quality, ownership, and readiness.",
      icon: "Building2",
      version: "1.0.0",
      permissions: ["data-foundations:read", "data-foundations:write", "tables:read"],
      defaultMode: "canvas",
      installKey: "builtin_data-foundations",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
    },
  ];

  const missing = builtIns.filter((b) => !existingIds.has(b.id));
  const existingMap = new Map(existing.map((e) => [e.id, e]));
  const changed = builtIns.filter((b) => {
    const e = existingMap.get(b.id);
    if (!e) return false;
    // Compare key fields that affect runtime behavior
    const fieldsToCompare: (keyof RegistryEntry)[] = [
      "name", "description", "icon", "version", "permissions",
      "defaultMode", "adminPanels", "chatTools", "chatCapabilities", "events",
      "packageId", "packageName", "premium", "entitlementMode", "bundledWithPlatform",
    ];
    return fieldsToCompare.some((f) => JSON.stringify(e[f]) !== JSON.stringify(b[f]));
  });

  const toWrite = [...missing, ...changed];
  if (toWrite.length === 0) return;

  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const app of toWrite) {
    store.put(app);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
