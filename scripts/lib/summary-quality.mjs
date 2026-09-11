// Issue #18：summary.json 的語意完整性檢查。
// 規則：有事件證據時，AI 摘要不得是「（暫無資料）」或空白——
// 那代表 LLM 回傳空值卻被當成功發佈。

export const SUMMARY_PLACEHOLDER = "（暫無資料）";

export function isPlaceholder(text) {
  const value = (text || "").trim();
  return !value || value === SUMMARY_PLACEHOLDER;
}

// 有證據但 LLM 沒產出時的誠實統計備援——寫實際數字，不寫「暫無資料」。
export function deterministicBrief(label, events) {
  const list = Array.isArray(events) ? events : [];
  if (!list.length) return SUMMARY_PLACEHOLDER;
  const byCategory = {};
  for (const event of list) {
    const category = event?.category || "未分類";
    byCategory[category] = (byCategory[category] || 0) + 1;
  }
  const top = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([category, count]) => `${category} ${count} 起`)
    .join("、");
  return `${label}共 ${list.length} 起，以 ${top} 為主。（系統統計值，AI 摘要未取得）`;
}

export function auditSummary({ summary, domesticCount = 0, internationalCount = 0 }) {
  const failures = [];
  const warnings = [];
  if (!summary || typeof summary !== "object") {
    if (domesticCount + internationalCount > 0) {
      failures.push({ code: "summary-missing", reason: "有事件資料但 summary.json 不存在或無法解析" });
    }
    return { ok: failures.length === 0, status: failures.length ? "fail" : "pass", failures, warnings };
  }
  const checks = [
    ["domestic", summary.domestic, domesticCount, "國內"],
    ["international", summary.international, internationalCount, "國際"],
  ];
  for (const [field, text, count, label] of checks) {
    if (count > 0 && isPlaceholder(text)) {
      failures.push({
        code: "empty-brief-with-evidence",
        field,
        reason: `${label}有 ${count} 筆事件，但摘要為「${SUMMARY_PLACEHOLDER}」或空白`,
      });
    }
    if (count === 0 && !isPlaceholder(text)) {
      warnings.push({
        code: "brief-without-evidence",
        field,
        reason: `${label}無事件但摘要非預設文字（可能引用過期上下文）`,
      });
    }
  }
  if (summary.degraded) {
    warnings.push({ code: "summary-degraded", reason: "摘要含統計備援段落（LLM 未取得回應）" });
  }
  return {
    ok: failures.length === 0,
    status: failures.length ? "fail" : "pass",
    failures,
    warnings,
  };
}
