// 儲存空間被封鎖或額度不足時，保留本頁操作狀態；getter 也必須在 try 內。
const memory = new Map<string, string | null>();

export const safeStorage = {
  getItem(key: string): string | null {
    if (memory.has(key)) return memory.get(key)!;
    try {
      const value = localStorage.getItem(key);
      memory.set(key, value);
      return value;
    } catch { return null; }
  },
  setItem(key: string, value: string): boolean {
    memory.set(key, value);
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  removeItem(key: string): void {
    memory.set(key, null);
    try { localStorage.removeItem(key); } catch { /* 本頁仍保留移除結果。 */ }
  },
};
