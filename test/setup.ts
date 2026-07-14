import "@testing-library/jest-dom/vitest";

const values = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => void values.delete(key),
  setItem: (key, value) => void values.set(key, String(value)),
};

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage });
}
