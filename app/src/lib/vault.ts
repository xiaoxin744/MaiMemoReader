/**
 * 凭证保险箱：默认只存在内存 + sessionStorage（当前会话），
 * 用户显式勾选「本机长期保存」后才写入 IndexedDB。
 * 真实密钥一律不进入构建产物、日志或导出文件。
 */
import { idb } from './db';

const SESSION_PREFIX = 'memo-reader.secret.';
const memory = new Map<string, string>();

export type SecretName = 'deepseekKey' | 'customApiKey' | 'maimemoToken' | `oidc:${string}`;

async function readPersisted(name: string): Promise<string | undefined> {
  const rec = await idb.get<{ value: string }>('secrets', name);
  return rec?.value;
}

export const secrets = {
  async get(name: SecretName): Promise<string> {
    const cached = memory.get(name);
    if (cached) return cached;
    try {
      const s = sessionStorage.getItem(SESSION_PREFIX + name);
      if (s) {
        memory.set(name, s);
        return s;
      }
    } catch {
      /* 隐私模式下 sessionStorage 可能不可用 */
    }
    const persisted = await readPersisted(name);
    if (persisted) {
      memory.set(name, persisted);
      return persisted;
    }
    return '';
  },

  async set(name: SecretName, value: string, persist: boolean): Promise<void> {
    if (!value) {
      await secrets.clear(name);
      return;
    }
    memory.set(name, value);
    try {
      sessionStorage.setItem(SESSION_PREFIX + name, value);
    } catch {
      /* ignore */
    }
    if (persist) {
      await idb.put('secrets', name, { value, savedAt: Date.now() });
    } else {
      await idb.del('secrets', name);
    }
  },

  async clear(name: SecretName): Promise<void> {
    memory.delete(name);
    try {
      sessionStorage.removeItem(SESSION_PREFIX + name);
    } catch {
      /* ignore */
    }
    await idb.del('secrets', name);
  },

  async isPersisted(name: SecretName): Promise<boolean> {
    return Boolean(await readPersisted(name));
  },

  /** 退出登录 / 清除数据时统一抹掉 */
  async clearAll(): Promise<void> {
    memory.clear();
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith(SESSION_PREFIX))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    await idb.clear('secrets');
  },
};

/** 掩码展示：只保留末尾四位，登录态回显用 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
