// Family Vault — IndexedDB layer.
// One small wrapper around native IndexedDB. No external dependency,
// so this keeps working with zero network access forever.

const DB_NAME = "familyVaultDB";
const DB_VERSION = 1;

const FVDB = (() => {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains("members")) {
          const s = db.createObjectStore("members", { keyPath: "id" });
          s.createIndex("name", "name");
        }
        if (!db.objectStoreNames.contains("categories")) {
          const s = db.createObjectStore("categories", { keyPath: "id" });
          s.createIndex("group", "group");
        }
        if (!db.objectStoreNames.contains("documents")) {
          const s = db.createObjectStore("documents", { keyPath: "id" });
          s.createIndex("memberId", "memberId");
          s.createIndex("categoryId", "categoryId");
          s.createIndex("expiryDate", "expiryDate");
          s.createIndex("favorite", "favorite");
          s.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("files")) {
          const s = db.createObjectStore("files", { keyPath: "id" });
          s.createIndex("documentId", "documentId");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("shareLog")) {
          const s = db.createObjectStore("shareLog", { keyPath: "id" });
          s.createIndex("documentId", "documentId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(storeNames, mode = "readonly") {
    return open().then((db) => db.transaction(storeNames, mode));
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, value) {
    const t = await tx([store], "readwrite");
    const r = reqToPromise(t.objectStore(store).put(value));
    return r;
  }

  async function get(store, key) {
    const t = await tx([store]);
    return reqToPromise(t.objectStore(store).get(key));
  }

  async function del(store, key) {
    const t = await tx([store], "readwrite");
    return reqToPromise(t.objectStore(store).delete(key));
  }

  async function all(store) {
    const t = await tx([store]);
    return reqToPromise(t.objectStore(store).getAll());
  }

  async function allByIndex(store, index, value) {
    const t = await tx([store]);
    return reqToPromise(t.objectStore(store).index(index).getAll(value));
  }

  async function clearStore(store) {
    const t = await tx([store], "readwrite");
    return reqToPromise(t.objectStore(store).clear());
  }

  function uid(prefix = "") {
    const rand = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}${Date.now().toString(36)}${rand[0].toString(36)}${rand[1].toString(36)}`;
  }

  return { open, put, get, del, all, allByIndex, clearStore, uid };
})();
