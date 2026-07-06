// 來源失敗時沿用舊快照的統一語義：成功→本輪事件；EXCLUSIVE 窄抓（dropStale）→ 清空；否則→舊快照按 datasetId 篩選。
export function carryOver({ status, fresh = [], dropStale = () => false, oldEvents = [], match } = {}) {
  if (status?.ok) return fresh;
  if (dropStale(status)) return [];
  const previousEvents = Array.isArray(oldEvents) ? oldEvents : [];
  if (typeof match === "function") return previousEvents.filter(match);
  return previousEvents.filter((e) => e.source?.datasetId === match);
}
