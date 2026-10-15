// Issue #18：summary.json 的語意完整性與品質閘門契約。
// 核心原則：
// 1. 有事件證據時，AI 摘要不得為空白或「（暫無資料）」佔位字串——否則代表 LLM 回應失敗卻被冒充為成功。
// 2. 當 LLM 回應不可用時，提供確定性統計備援（deterministic statistical brief），
//    明確標記「AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援」，不冒充正常 AI 生成。
// 3. 真正無事件為正常空狀態，不應誤報為生成失敗。
// 4. 只有 reference rows 時，亦不應誤判為事件證據。
// 5. 預設模式接受統計備援（warning），嚴格模式（requireNarrative）才阻擋發布。

export const SUMMARY_PLACEHOLDER = "（暫無資料）";
export const FALLBACK_SIGNATURE = "系統統計備援";

export function isPlaceholder(text) {
  const value = (text || "").trim();
  return !value || value === SUMMARY_PLACEHOLDER;
}

export function isDeterministicFallback(text) {
  if (!text || typeof text !== "string") return false;
  return text.includes(FALLBACK_SIGNATURE) || text.includes("AI 摘要暫時無法生成");
}

// Reject visible reasoning traces and unexpectedly long or English-only model
// output before it can be mislabeled as a finished Chinese narrative.
export function isUsableNarrative(text) {
  if (typeof text !== "string" || isPlaceholder(text) || isDeterministicFallback(text)) return false;
  const value = text.trim();
  const reasoningPrefix = /^(?:#{1,6}\s*)?(?:analysis|reasoning|thoughts?|thinking|we (?:need to|should|must)|i (?:need to|should|will)|let(?:'s| us| me) (?:think|analy[sz]e))\b/i;
  if (value.length > 600 || /<\/?(?:think|analysis|reasoning)\b[^>]*>/i.test(value) || reasoningPrefix.test(value)) return false;
  const han = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const latin = (value.match(/[a-z]/gi) || []).length;
  return han > 0 && (latin < 40 || latin <= han * 2);
}

// 有事件證據但 LLM 無法取得有效敘述時的確定性統計備援。
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

  return `${label}共 ${list.length} 起，以 ${top} 為主。（AI 摘要暫時無法生成，事件資料仍可查閱；此為系統統計備援）`;
}

export function auditSummary({
  summary,
  domesticCount = 0,
  internationalCount = 0,
  requireNarrative = false,
}) {
  const failures = [];
  const warnings = [];

  if (!summary || typeof summary !== "object") {
    if (domesticCount + internationalCount > 0) {
      failures.push({
        code: "summary-missing",
        reason: "有事件資料但 summary.json 不存在或無法解析",
      });
    }
    return {
      ok: failures.length === 0,
      status: failures.length ? "fail" : "pass",
      failures,
      warnings,
    };
  }

  const isScopeDegraded = (field) => {
    if (!summary.degraded) return false;
    if (typeof summary.degraded === "boolean") return summary.degraded;
    return Boolean(summary.degraded[field]);
  };

  const checks = [
    ["domestic", summary.domestic, domesticCount, "國內"],
    ["international", summary.international, internationalCount, "國際"],
  ];

  for (const [field, text, count, label] of checks) {
    const isDegraded = isScopeDegraded(field) || isDeterministicFallback(text);
    const placeholder = isPlaceholder(text);

    if (count > 0) {
      if (placeholder) {
        failures.push({
          code: "empty-brief-with-evidence",
          field,
          reason: `${label}有 ${count} 筆事件，但摘要為「${SUMMARY_PLACEHOLDER}」或空白（無敘述且無備援）`,
        });
      } else if (isDegraded && !isDeterministicFallback(text)) {
        failures.push({
          code: "degraded-brief-without-fallback",
          field,
          reason: `${label}摘要標記降級，但未提供可辨識的系統統計備援`,
        });
      } else if (!isDegraded && !isUsableNarrative(text)) {
        failures.push({
          code: "invalid-ai-brief",
          field,
          reason: `${label}AI 摘要含推理痕跡、過長或不是可用的繁體中文敘述`,
        });
      } else if (isDegraded) {
        if (requireNarrative) {
          failures.push({
            code: "narrative-required-but-degraded",
            field,
            reason: `${label}有 ${count} 筆事件，但僅有統計備援（嚴格敘述模式要求完整 AI 摘要）`,
          });
        } else {
          warnings.push({
            code: "summary-degraded",
            field,
            reason: `${label}摘要使用系統統計備援（LLM 未取得敘述，已啟用確定性統計）`,
          });
        }
      }
    } else {
      // count === 0
      if (!placeholder) {
        warnings.push({
          code: "brief-without-evidence",
          field,
          reason: `${label}無事件但摘要非預設空字串（可能引用過期上下文）`,
        });
      }
    }
  }

  return {
    ok: failures.length === 0,
    status: failures.length ? "fail" : "pass",
    failures,
    warnings,
  };
}
