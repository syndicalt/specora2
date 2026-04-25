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
    req.onsuccess = () => resolve(req.result as RegistryEntry[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
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

export async function uninstallApp(id: string, clearData: boolean = false): Promise<void> {
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
      permissions: ["read:cmdb"],
      defaultMode: "canvas",
      installKey: "builtin_cmdb-explorer",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
      chatCapabilities: [
        {
          id: "cmdb.search",
          label: "Search CMDB",
          description: "Find CIs by name, class, or property",
          prompt: "Search the CMDB",
          icon: "Database",
        },
        {
          id: "cmdb.list-servers",
          label: "List all servers",
          description: "Show every Server-class CI",
          prompt: "List all servers in the CMDB",
          icon: "Server",
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
      description: "Manage RBAC permissions and system properties.",
      icon: "Shield",
      version: "1.0.0",
      permissions: ["rbac:read", "rbac:write", "system-properties:read", "system-properties:write"],
      defaultMode: "window",
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
  ];

  const missing = builtIns.filter((b) => !existingIds.has(b.id));
  const existingMap = new Map(existing.map((e) => [e.id, e]));
  const changed = builtIns.filter((b) => {
    const e = existingMap.get(b.id);
    if (!e) return false;
    // Compare key fields that affect runtime behavior
    const fieldsToCompare: (keyof RegistryEntry)[] = [
      "name", "description", "icon", "version", "permissions",
      "defaultMode", "adminPanels", "chatTools", "events",
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
