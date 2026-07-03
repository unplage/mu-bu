// db.js — 基于 IndexedDB 的本地文档存储
import { uid, deepClone } from './utils.js';

const DB_NAME = 'mubu-lite';
const DB_VERSION = 1;
const STORE = 'docs';

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function db() {
  if (!_db) _db = await openDB();
  return _db;
}

function tx(store, mode) {
  return db().then((d) => d.transaction(store, mode).objectStore(store));
}

/** 创建空文档骨架 */
export function createDoc(title = '未命名文档') {
  const now = Date.now();
  return {
    id: uid('doc'),
    title,
    createdAt: now,
    updatedAt: now,
    root: {
      id: uid('n'),
      text: title,
      note: '',
      color: null,
      collapsed: false,
      children: [],
    },
  };
}

/** 创建空白节点 */
export function createNode(text = '') {
  return {
    id: uid('n'),
    text,
    note: '',
    color: null,
    collapsed: false,
    children: [],
  };
}

export async function listDocs() {
  const store = await tx(STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const docs = req.result || [];
      docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(docs.map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt })));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getDoc(id) {
  const store = await tx(STORE, 'readonly');
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDoc(doc) {
  doc.updatedAt = Date.now();
  const store = await tx(STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put(deepClone(doc));
    req.onsuccess = () => resolve(doc);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDoc(id) {
  const store = await tx(STORE, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function upsertDoc(doc) {
  return saveDoc(doc);
}
