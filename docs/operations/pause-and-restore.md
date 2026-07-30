# 線上暫停與復原

狀態基準：2026-07-30（Asia/Taipei）。這是可逆暫停，不是下架或刪除專案。

## 目前狀態

- GitHub Actions `update-and-deploy.yml`：`disabled_manually`，無排隊或執行中的 run。
- Cloudflare Pages canonical：維護頁，所有路徑回應 HTTP 503。
- GitHub Pages：已取消發布，回應 HTTP 404。
- 維護頁來源：`ops/maintenance/`。
- 暫停部署 ID：`f5a69059-e5d6-49d1-a1f0-a53509b75e16`。
- 原正式部署 ID：`11d5591e-b0f8-4595-b6bb-ba630062d08f`。

Cloudflare 的歷史部署網址是不可變部署，仍可能直接存取；canonical 已暫停不代表歷史網址消失。若需要全面封鎖，應另設 Cloudflare Access 或刪除歷史部署，後者不是本次可逆暫停的一部分。

## 暫停期間驗證

```powershell
gh api 'repos/{owner}/{repo}/actions/workflows/update-and-deploy.yml' --jq '.state'
gh run list --workflow update-and-deploy.yml --status in_progress
gh run list --workflow update-and-deploy.yml --status queued
curl.exe -I https://taiwan-intel-dashboard.pages.dev/
curl.exe -I https://reese-max.github.io/taiwan-intel-dashboard/
```

預期：workflow 為 `disabled_manually`、兩個 run 清單為空、Cloudflare 為 503、GitHub Pages 為 404。

## 資料膨脹修正（尚未部署）

最近排程在 `npm run audit:data-size -- --max-mb=24` 失敗。根因已在本機共用寫入點修正：分類／來源摘要不再複製完整 `records`，載入舊 history 時會一併壓平；ledger 改為最多 8 MiB 的近期去重快取，並優先保留 history 保留窗內的指紋。

以目前 `gh-pages` 快照做不寫檔 canary：history 由 24,897,528 bytes 降至 12,166,767 bytes，51 個 runs 全保留；ledger 目前 4,713,316 bytes，未達上限，因此 25,488 個指紋全保留。此結果尚未部署，線上仍維持暫停。

## 復原順序

1. 確認資料膨脹修正通過 `npm test`、`npm run build`、`npm run audit:data-size -- --max-mb=24`。
2. 在 Cloudflare Pages 將 production 回滾到原正式部署 ID。
3. 確認 canonical 首頁與必要 JSON 都回應 200，內容不是維護頁。
4. 執行 `gh workflow enable update-and-deploy.yml`。
5. 手動執行一次受控更新並監看完成：

   ```powershell
   gh workflow run update-and-deploy.yml -f mode=hourly -f renorm_intl=false
   gh run watch --exit-status
   ```

6. 再次 smoke test canonical。若仍需要 GitHub Pages 備援入口，最後才把來源設回 `gh-pages`；否則維持未發布。

不要先啟用排程：目前每 30 分鐘的 schedule 會再次撞上尺寸閘門，且可能與人工復原互相干擾。
