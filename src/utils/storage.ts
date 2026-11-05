// 儲存空間被封鎖或額度不足時，保留本頁操作狀態；getter 也必須在 try 內。
const memory = new Map<string, string | null>();

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      const value = localStorage.getItem(key);
      memory.set(key, value);
      return value;
    } catch { return memory.get(key) ?? null; }
  },
  setItem(key: string, value: string): boolean {
    memory.set(key, value);
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  removeItem(key: string): void {
    memory.set(key, null);
    try { localStorage.removeItem(key); } catch { /* 本頁仍保留移除結果。 */ }
  },
  isAvailable(): boolean {
    try {
      const key = `taiwan-intel-storage-probe-${Math.random()}`;
      localStorage.setItem(key, key);
      localStorage.removeItem(key);
      return true;
    } catch { return false; }
  },
};
