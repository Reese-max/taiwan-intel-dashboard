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

## 資料膨脹修正（已推送、未部署）

最近排程在 `npm run audit:data-size -- --max-mb=24` 失敗。根因已在本機共用寫入點修正：分類／來源摘要不再複製完整 `records`，載入舊 history 時會一併壓平；ledger 改為最多 8 MiB 的近期去重快取，並優先保留 history 保留窗內的指紋。

以目前 `gh-pages` 快照做不寫檔 canary：history 由 24,897,528 bytes 降至 12,166,767 bytes，51 個 runs 全保留；ledger 目前 4,713,316 bytes，未達上限，因此 25,488 個指紋全保留。此結果尚未部署，線上仍維持暫停。

### 2026-07-30 雲端 Dry Run 紀錄

- 根因修正：commit `60120cc39160360b73cadaf26fa159bf09bbeb30`。
- 不部署 workflow：`.github/workflows/pipeline-dry-run.yml`，commit `db96ac84d428f98755449d3a66422ded7c66d9c9`。
- GitHub Actions run：`30526543108`，結論 `success`。
- workflow 僅允許 `workflow_dispatch`，權限為 `contents: read`，固定抓取 `--sources=police`；不含 `git push`、GitHub Pages 或 Cloudflare 部署步驟。
- 從 `gh-pages` 還原既有狀態後，真實抓取警政資料 6,590 筆；80 個測試檔、549 項測試全部通過，靜態建置成功。
- coverage、來源可追溯性、情報網品質與資料尺寸稽核全部通過；`police-hourly-history.json` 11.6 MB、`police-seen-ledger.json` 4.5 MB，所有資料檔皆低於 24 MB 閘門。
- 暫停資料必然逐漸過期，因此此 police-only dry run 刻意不執行 `audit:source-freshness`，避免把預期中的 carry-over stale 狀態誤判為膨脹修正失敗。
- run 完成後再次確認：`update-and-deploy.yml` 仍為 `disabled_manually`、無執行中部署、`gh-pages` 仍停在 `6b36df0d023226a338cd613e016047543724c798`、Cloudflare canonical 與資料路徑仍回應 503、GitHub Pages 仍回應 404。

這是舊版 police-only dry-run 的歷史證據；新架構推送後，同名 workflow 會改跑下節所述的全來源驗證。

## P0／P1 部署架構（本機待推送）

- `.github/workflows/pipeline.yml` 是正式與 dry-run 共用的唯一管線。
- `fetch` 產生候選資料 artifact；`save-state` 只更新獨立的 `pipeline-state` 分支；`audit` 對同一份 artifact 執行測試、建置與稽核；`deploy` 僅在狀態保存及稽核都成功後執行。
- `.github/workflows/pipeline-dry-run.yml` 固定使用 `refresh` 全來源模式，權限為 `contents: read`，且傳入 `save_state: false`、`deploy: false`。
- `pipeline-state` 尚未建立時，第一輪會從既有 `gh-pages/data` 遷移狀態；dry-run 不會建立或修改該分支。
- 本節目前只有本機修改，尚未 commit、push 或執行雲端全來源 dry-run；線上正式 workflow 仍維持停用。

## 復原順序

1. 推送架構修正後，先執行全來源 dry-run，確認 fetch、測試、建置與全部稽核通過：

   ```powershell
   gh workflow run pipeline-dry-run.yml --ref main -f renorm_intl=false
   gh run watch --exit-status
   ```

2. 在 Cloudflare Pages 將 production 回滾到原正式部署 ID。
3. 確認 canonical 首頁與必要 JSON 都回應 200，內容不是維護頁。
4. 執行 `gh workflow enable update-and-deploy.yml`。
5. 手動執行一次受控更新並監看完成：

   ```powershell
   gh workflow run update-and-deploy.yml -f mode=hourly -f renorm_intl=false
   gh run watch --exit-status
   ```

6. 再次 smoke test canonical。若仍需要 GitHub Pages 備援入口，最後才把來源設回 `gh-pages`；否則維持未發布。

不要略過全來源 dry-run 就啟用排程；排程可能與人工復原互相干擾，且本機通過不等於 GitHub secrets、外部來源與 Cloudflare 路徑已驗證。
