import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // e2e/ 是 Playwright spec（npm run test:e2e 跑），vitest 預設 include 會誤撿導致 npm test 永遠紅。
  test: { environment: "node", exclude: [...configDefaults.exclude, "e2e/**"] },
});
