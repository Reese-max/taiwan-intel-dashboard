import { defineConfig } from "@playwright/test";

// 最小 E2E：只驗 3 條關鍵路徑（載入/切 scope/風險篩選），against `vite preview`（dist 產物）。
// 不做快照比對（避免 flaky）；截圖存 e2e-artifacts/ 供人工視覺 diff。
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4173",
    locale: "zh-TW",
  },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
