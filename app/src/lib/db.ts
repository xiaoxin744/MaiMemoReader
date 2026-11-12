/** 轻量 IndexedDB 封装：无第三方依赖，所有业务表集中在这里声明。 */

export const DB_NAME = 'memo-reader';
export const DB_VERSION = 1;

export type StoreName =
  | 'kv'
  | 'secrets'
  | 'snapshots'
  | 'articles'
  | 'questions'
  | 'attempts'
  | 'tasks'
  | 'glossary'
  | 'sessions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [
        'kv',
        'secrets',
        'snapshots',
        'articles',
        'questions',
        'attempts',
        'tasks',
        'glossary',
        'sessions',
      ] as StoreName[]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页占用，请关闭其它窗口后重试'));
  });
  return dbPromise;
}

async function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
  });
}

export const idb = {
  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    const value = await tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
    return value;
  },
  async put(store: StoreName, key: string, value: unknown): Promise<void> {
    await tx(store, 'readwrite', (s) => s.put(value, key));
  },
  async del(store: StoreName, key: string): Promise<void> {
    await tx(store, 'readwrite', (s) => s.delete(key));
  },
  async all<T>(store: StoreName): Promise<T[]> {
    const values = await tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
    return values ?? [];
  },
  async clear(store: StoreName): Promise<void> {
    await tx(store, 'readwrite', (s) => s.clear());
  },
};

/** 简易持久化文本存储（设置、标记位） */
export const kv = {
  get: <T>(key: string) => idb.get<T>('kv', key),
  set: (key: string, value: unknown) => idb.put('kv', key, value),
  del: (key: string) => idb.del('kv', key),
};
