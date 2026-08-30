import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 4173);

// 最小 E2E：只驗 3 條關鍵路徑（載入/切 scope/風險篩選），against `vite preview`（dist 產物）。
// 不做快照比對（避免 flaky）；截圖存 e2e-artifacts/ 供人工視覺 diff。
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
    locale: "zh-TW",
  },
  webServer: {
    command: `npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
