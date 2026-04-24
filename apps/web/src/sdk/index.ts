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
      icon: "Network",
      version: "1.0.0",
      permissions: ["read:cmdb", "read:relationships"],
      defaultMode: "canvas",
      installKey: "builtin_service-map",
      source: "built-in",
      publisher: "Specora",
      installedAt: Date.now(),
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
  ];

  const missing = builtIns.filter((b) => !existingIds.has(b.id));
  if (missing.length === 0) return;

  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const app of missing) {
    store.put(app);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
