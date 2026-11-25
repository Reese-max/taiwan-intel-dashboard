# Google News 轉發（站外搜尋上游）

`/api/search`（`static/_worker.js`）改經這個轉發查 Google News RSS：Google 會對 Cloudflare Worker 的出口 IP 回 429／503（2026-11-25 正式站與 Preview 實測，加 User-Agent 也無效）。

- 位置：`oracle-agent-hub`（tailnet 名稱 `video-mcp-a1`），程式在 `~/gnews-proxy/proxy.py`，systemd `gnews-proxy.service`，只聽 `127.0.0.1:8331`。
- 對外：Tailscale Funnel `https://video-mcp-a1.tail930e77.ts.net/gnews` → `http://127.0.0.1:8331/rss`。
- 只轉 Google News RSS 搜尋：上游寫死、查詢規則與 Worker 相同（1–120 字、天數 1/2/3/7/30），不能拿來連其他網站；10 分鐘快取、每分鐘 60 次全域上限。只用 Python 標準庫。

## 共享密鑰

Worker 以 `X-Relay-Key` 標頭帶 Pages secret `GNEWS_RELAY_KEY`（production 與 preview 環境都要設）；轉發端讀 `~/gnews-proxy/relay.key`（權限 0600），不符回 401。沒有 `relay.key` 時不檢查，用於分段上線。

輪替：產生新值寫入檔案，`npx wrangler pages secret put GNEWS_RELAY_KEY --project-name taiwan-intel-dashboard [--env preview] < 檔案`，等正式站重新部署後再換主機上的 `relay.key` 並 `sudo systemctl restart gnews-proxy`。密鑰值不寫進 repo、commit 或 log。

## 部署／更新

```bash
scp proxy.py gnews-proxy.service ubuntu@<host>:gnews-proxy/
ssh ubuntu@<host> 'cd ~/gnews-proxy && python3 -I -X utf8 proxy.py --self-test \
  && sudo install -m 0644 gnews-proxy.service /etc/systemd/system/ \
  && sudo systemctl daemon-reload && sudo systemctl restart gnews-proxy'
curl -s -o /dev/null -w '%{http_code}\n' 'https://video-mcp-a1.tail930e77.ts.net/gnews?q=%E8%A9%90%E9%A8%99&days=7'   # 200
```

加路徑時用 **`tailscale funnel --bg --https=443 --set-path=/gnews http://127.0.0.1:8331/rss`**。
不要用 `tailscale serve`：它會把 443 原有的 Funnel 關掉，`/` 與 `/tekao` 會變成只有 tailnet 能連（2026-11-25 踩到，已用備份 `tailscale serve set-raw` 還原）。改設定前先 `tailscale serve status --json > 備份檔`。

停用：`sudo tailscale funnel --https=443 --set-path=/gnews off`，再 `sudo systemctl disable --now gnews-proxy`；Worker 會回到降級提示。
