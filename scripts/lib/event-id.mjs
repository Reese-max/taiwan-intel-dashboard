function slug(link, idx) {
  // 以連結內容 hash 確保唯一，避免不同文章因路徑片段相同而撞 id
  const s = link || `n${idx}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export { slug };

export const eventIdFor = (scope, link) => (link ? `${scope === "domestic" ? "twnews" : "intl"}-${slug(link)}` : null);
