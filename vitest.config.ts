import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // e2e/ 是 Playwright spec（npm run test:e2e 跑），vitest 預設 include 會誤撿導致 npm test 永遠紅。
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    // 長時整合測試與 89 個 test files 同時啟動預設 CPU 數 worker 會觸發 Tinypool worker 非正常退出。
    poolOptions: { threads: { minThreads: 1, maxThreads: 4 } },
  },
});
