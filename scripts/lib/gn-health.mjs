export function googleNewsHealth(feedStatus, { minOkRate = 0.5 } = {}) {
  if (!Array.isArray(feedStatus) || feedStatus.length === 0) {
    return { gnFeeds: 0, gnOk: 0, okRate: 1, systemic: false };
  }

  const gnStatuses = feedStatus.filter((status) => status?.gn === true);
  const gnFeeds = gnStatuses.length;
  if (!gnFeeds) return { gnFeeds: 0, gnOk: 0, okRate: 1, systemic: false };

  const gnOk = gnStatuses.filter((status) => status?.ok === true && Number(status?.count || 0) > 0).length;
  const okRate = Number((gnOk / gnFeeds).toFixed(4));
  return {
    gnFeeds,
    gnOk,
    okRate,
    systemic: gnFeeds >= 5 && okRate < minOkRate,
  };
}
