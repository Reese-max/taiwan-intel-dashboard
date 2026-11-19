// 標題正規化鍵：去掉「 - 媒體名／｜媒體名」尾綴與所有非中英數字元，用於跨來源/跨查詢去重。
export function titleKey(title) {
  return String(title || "")
    .replace(/\s*[-|｜–—]\s*[^-|｜–—]{1,20}$/, "")
    .replace(/[^一-鿿A-Za-z0-9]/g, "")
    .toLowerCase();
}

export function dedupeTitleKey(title) {
  let value = String(title || "").trim();
  value = value.replace(/^(?:(?:快訊|影|影音|獨家|最新)(?:\s*[／/：:｜|]\s*|\s+))+/u, "");
  let previous;
  do {
    previous = value;
    value = value.replace(/\s*[-|｜–—]\s*[^\-|｜–—]{1,40}$/u, "").trim();
  } while (value !== previous);
  return value.replace(/[^一-鿿A-Za-z0-9]/g, "").toLowerCase();
}

