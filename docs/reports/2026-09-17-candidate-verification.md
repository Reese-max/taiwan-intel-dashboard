# 候選查證語意 B1：修改與驗證紀錄

基準 `3358fa2f8badb130c8befd1c477ff151e92e5e5c`，Refs #36；本輪不是全部 V1 完成。

## 修改前證據

從已連接 GitHub 讀取固定版本；本機重建的 corroboration.ts、actionDecision.ts、EventCard.ts、network.ts 以 Git blob SHA 核對完全一致。用真正的 NetworkIndex 和兩個來源 fixture 執行，結果：sources=2、confirmed=true，卡片顯示勾選佐證，high 新聞建議由原文查證變為一般類別行動。這是合成函式重現，不是正式案件量測。

## 修改

新增明示 unverified；保留 confirmed 舊欄位但自動候選固定 false。卡片與行動提示共用保守文案；不採舊 confirmed=true 當人工核實。首頁 same-incident 型別名稱改為同事件候選。
原 URL／發布者去重和既有計数保留，未解決所有轉載來源 identity。未改風險模型、危急政策、候選邊或自動收合。

## 本機實際執行

- Node v22.16.0。新增 `tests/candidate-verification.test.ts` 16 個案例，以 TypeScript 轉譯後將測試註冊入口由 Vitest 改為 node:test，保留相同 node:assert/strict 斷言與原生產模組：16 pass、0 fail、0 skip。沒有替換產品函式。
- 四個修改中的 src 模組及其相依型別執行 strict TypeScript noEmit 通過；不是全專案型別檢查。
- 修改前 npm test 與修改後 npm run check 在本機缺 Vitest（exit 127），不能宣稱本機全套通過。工作目錄只重建需要的來源檔，完整依賴／快照建置由遠端 CI 驗證。
- 舊 corroboration 與 card 測試情境保留，更新已不適用的「來源數＝確認」斷言；來源去重驗證不刪除。
- dashboard E2E 的佐證測試改成固定候選資料，驗證待查證及查證提醒，不再因 live data 缺少徽章而 skip。此 E2E 已撰寫，本文建立時尚未在瀏覽器執行。

## 遠端與剩餘驗收

本文件建立時 PR/CI 尚待提交；後續遠端結果以該 PR 中具 exact head 的執行收據為準，不沿用 #33 的舊 CI。
正式資料語意抽驗、瀏覽器／手機操作與全站 legacy 文案尚未完成；不宣稱 CLEAN、不自動合併、不正式發布。
B2 的群集與收合、C 的位置政策、D 的同版快照、E 的站內探索分別由 #36–#39 追蹤。
