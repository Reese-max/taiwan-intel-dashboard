import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // e2e/ 是 Playwright spec（npm run test:e2e 跑），vitest 預設 include 會誤撿導致 npm test 永遠紅。
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "e2e/**"],
    // 長時整合測試含同步子進程與大量 timer，threads pool 偶發觸發 Tinypool worker 非正常退出。
    // forks 將 worker lifecycle 隔離到 child process，singleFork 保證整批測試只回收一個可控的執行器。
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    teardownTimeout: 30_000,
  },
});
