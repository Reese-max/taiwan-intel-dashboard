# 風險評級品質基線測試驗證

日期：2026-08-05（Asia/Taipei）

## 指定測試

命令：

```text
npm test -- tests/f1ffd2f768e6facc-risk-rating-quality-baseline.test.*
```

Windows PowerShell 不會替原生程式展開這個萬用字元；驗證時由 Bash 展開路徑，再呼叫 Windows `npm`，實際交給 npm 的命令仍是上列指定命令。成功輸出如下：

```text
> test
> vitest run tests/f1ffd2f768e6facc-risk-rating-quality-baseline.test.ts

✓ tests/f1ffd2f768e6facc-risk-rating-quality-baseline.test.ts (11 tests)

Test Files  1 passed (1)
Tests       11 passed (11)
```

結果：exit code 0。固定標註集包含 10 個風險案例，另有 1 個整體評分案例；共 11 個測試全部通過。

## 提交追溯

目標測試檔 `tests/f1ffd2f768e6facc-risk-rating-quality-baseline.test.ts` 已納入目前分支歷史，檔案新增提交為：

```text
bb3e40627546be6870f1f447170d352a1337e0c2 test(risk): 新增風險評級品質基線
```

該提交已是目前 `HEAD` 的祖先，且目前索引中的目標測試檔 blob 為 `3f9e4d49a401cac28bf779a7444d01511ab9fa54`。
