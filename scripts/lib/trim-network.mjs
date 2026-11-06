// Deployment projection only. Keep every node ID (including isolated nodes) so
// ready/empty state and counts survive; event details come from the event files.
// dedupeWhy：edge.why 改成 whyTexts 字典索引。前端兩種格式都讀得懂，但 AGENTS.md 第 7 條禁止同版本
// 換格式又換讀取程式（已開著舊頁面的人會看到數字）。先上線讀取端，下一版再把 build 改成 { dedupeWhy: true }。
export function trimNetwork(net, { dedupeWhy = false } = {}) {
  const trimScope = (scope) => {
    // 缺 scope 或格式不符就原樣交出，由前端／契約檢查處理，不讓 build 因精簡而失敗。
    if (!scope || typeof scope !== "object" || Array.isArray(scope) || !Array.isArray(scope.edges)) return scope;
    const whyTexts = [];
    const whyIds = new Map();
    return {
      ...scope,
      nodes: Array.isArray(scope.nodes) ? scope.nodes.map((node) => (node && typeof node === "object" ? { id: node.id } : node)) : scope.nodes,
      edges: scope.edges.map((edge) => {
        if (!edge || typeof edge !== "object") return edge;
        const { a, b, type, weight, why, from, origin, decision, curationId } = edge;
        // 人工更正的出處要留在部署檔（tests/curation-rebuild.test.ts）；自動邊（絕大多數）省略 origin:"auto"。
        const provenance = origin && origin !== "auto"
          ? { origin, ...(decision !== undefined ? { decision } : {}), ...(curationId !== undefined ? { curationId } : {}) }
          : {};
        if (!dedupeWhy) return { a, b, type, weight, why, ...(from !== undefined ? { from } : {}), ...provenance };
        if (!whyIds.has(why)) {
          whyIds.set(why, whyTexts.length);
          whyTexts.push(why);
        }
        return { a, b, type, weight, why: whyIds.get(why), ...(from !== undefined ? { from } : {}), ...provenance };
      }),
      ...(dedupeWhy ? { whyTexts } : {}),
    };
  };
  if (!net || typeof net !== "object" || Array.isArray(net)) return net;
  return {
    ...net,
    ...("domestic" in net ? { domestic: trimScope(net.domestic) } : {}),
    ...("international" in net ? { international: trimScope(net.international) } : {}),
  };
}
