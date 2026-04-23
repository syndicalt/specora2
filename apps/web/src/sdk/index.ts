export interface AppManifest {
  id: string;
  name: string;
  icon: string;
  version: string;
  permissions: string[];
  defaultMode: "canvas" | "window";
}

export interface RegistryEntry extends AppManifest {
  installKey: string;
  source: "built-in" | "external";
  installedAt: number;
}

export interface AppMessage {
  from: string;
  to: string;
  type: string;
  payload?: any;
}

export interface ShellAPI {
  installKey: string;
  appId: string;
  isActive: boolean;
  isDormant: boolean;
  sendMessage: (msg: Omit<AppMessage, "from">) => void;
  onMessage: (handler: (msg: AppMessage) => void) => () => void;
  notify: (message: string, type?: "info" | "success" | "error") => void;
}

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

export async function uninstallApp(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function seedBuiltInApps(): Promise<void> {
  const existing = await getRegistry();
  if (existing.length > 0) return;

  const builtIns: RegistryEntry[] = [
    {
      id: "service-map",
      name: "Service Map",
      icon: "Network",
      version: "1.0.0",
      permissions: ["read:cmdb", "read:relationships"],
      defaultMode: "canvas",
      installKey: "builtin_service-map",
      source: "built-in",
      installedAt: Date.now(),
    },
  ];

  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const app of builtIns) {
    store.put(app);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}
