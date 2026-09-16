const MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (c) => MAP[c]!);
}

// 去除殘留的 HTML 標籤（部分 RSS 摘要帶 <p style=…> 等），只剝標籤、保留文字。
// 顯示前先 stripHtml 再 esc：先除標籤，再安全轉義純文字。
export function stripHtml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
