// 情報網關聯引擎（純函式、零依賴）。
// 輸入：已正規化的 IntelEvent[]（警政/判決/新聞/天氣/採購/國際…）。
// 輸出：事件之間的「關聯圖」——把散落各源的孤立事件串成情報網。
//   · same-incident：同縣市 + 案類關鍵詞/實體重疊 + 時間相近 + 不同來源（跨源佐證，情報網骨幹）
//   · same-entity ：跨地共享同一具名實體（分局/地檢署/路名/行政區…）
//   · same-topic  ：同縣市同類同關鍵詞、時序相近（同一波相關情勢）
// 設計為 build-time 產出 network.json，前端僅載入呈現、零計算。

// ── 門檻常數（具名，便於調校）──
const DAY = 86400000;
const INCIDENT_WINDOW_MS = 3 * DAY; // 跨源佐證的時間窗
const TOPIC_WINDOW_MS = 2 * DAY; // 同題弱連結的時間窗
const PAIR_WINDOW_MS = Math.max(INCIDENT_WINDOW_MS, TOPIC_WINDOW_MS);
const INCIDENT_MIN_SCORE = 2; // 關鍵詞+實體+標題bigram 重疊分數門檻
const ENTITY_GENERIC_CAP = 40; // 某實體出現超過此數視為過於泛用，跳過（避免巨型團）
// 非地理性的「縣市」值：新聞常無縣市而落在「全國」，這類不可當作「同地」做 same-topic 連結
// （否則全國一塊會互相亂連成毛球）；same-incident 仍可成立（靠跨源+用詞，捕捉全國性議題）。
const VAGUE_REGION = new Set(["全國", "未知", "", "—", "-"]);
const W_INCIDENT = 1.0;
const W_ENTITY = 0.6;
const W_TOPIC = 0.3;
const CLUSTER_INCIDENT_MIN_WEIGHT = 1.5;
const CLUSTER_INCOHERENT_DOMINANT_SHARE = (() => {
  const n = Number(process.env.CLUSTER_INCOHERENT_DOMINANT_SHARE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.5;
})();
const CLUSTER_INCOHERENT_CATEGORY_ENTROPY = (() => {
  const n = Number(process.env.CLUSTER_INCOHERENT_CATEGORY_ENTROPY);
  return Number.isFinite(n) && n >= 0 ? n : 1.5;
})();
const CLUSTER_INCOHERENT_TOPIC_RATIO = (() => {
  const n = Number(process.env.CLUSTER_INCOHERENT_TOPIC_RATIO);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.4;
})();
const DEFAULT_SAME_ENTITY_UNION_BLOCKLIST = ["依托咪酯", "幼兒園"];
const SAME_ENTITY_UNION_BLOCKLIST = (() => {
  const raw = process.env.SAME_ENTITY_UNION_BLOCKLIST;
  const values = raw === undefined ? DEFAULT_SAME_ENTITY_UNION_BLOCKLIST : raw.split(",");
  return new Set(values.map((s) => s.trim()).filter(Boolean));
})();

// 案類關鍵詞 → 標準標籤（跨來源用同一套語彙，與 news-bulk 一致取向）。
const LEXICON = [
  [/詐騙|詐欺|車手|假投資|假交友|人頭帳戶|洗錢|假檢警|假冒|盜刷|釣魚/, "詐欺"],
  [/毒品|緝毒|販毒|製毒|安非他命|海洛因|大麻|愷他命|喪屍|依托咪酯|笑氣/, "毒品"],
  [/槍擊|槍枝|改造手槍|彈藥|子彈|開槍|中彈/, "槍械"],
  [/竊盜|失竊|偷竊|扒竊/, "竊盜"],
  [/搶奪|強盜|搶劫|擄|勒贖/, "強盜擄人"],
  [/砍人|持刀|刺死|刺傷|鬥毆|毆打|傷害/, "暴力"],
  [/命案|兇殺|凶殺|殺人|分屍|棄屍|陳屍|浮屍|遺體/, "命案"],
  [/性侵|性騷|猥褻|偷拍|性影像|性剝削/, "性犯罪"],
  [/家暴|家庭暴力|兒虐|虐童|虐待|跟蹤|跟騷/, "家暴虐待"],
  [/酒駕|毒駕|車禍|肇事|肇逃|追撞|翻車/, "交通"],
  [/火警|火災|氣爆|爆炸|爆裂|縱火/, "火災"],
  [/地震|規模.{0,3}地震|震度/, "地震"],
  [/颱風|豪雨|水災|淹水|土石|山崩/, "天災"],
  [/走私|偷渡|人口販運|人蛇/, "走私偷渡"],
  [/賭場|博弈|簽賭|賭博/, "賭博"],
  [/幫派|黑道|組織犯罪|掃黑|角頭/, "幫派"],
  [/貪污|收賄|圖利|掏空|背信|內線交易/, "貪瀆"],
  [/共諜|間諜|反滲透|認知作戰|統戰/, "國安"],
  [/失蹤|協尋|走失|失聯/, "失蹤協尋"],
  [/採購|決標|招標|標案|得標/, "採購"],
  [/起訴|偵辦|搜索|約談|羈押|收押|通緝|判刑|定讞|求刑/, "司法"],
];

// 具名實體抽取（跨事件可比對的專名）。
// 只收「具區辨力」的專名：機關級泛名（海巡署/移民署/法務部/XX警察局）遍布各則不相關新聞，
// 當連結鍵會把整片同機關新聞黏成一團，故刻意不納入。
const ENTITY_PATTERNS = [
  /[一-鿿]{2,4}分局/g,
  /[一-鿿]{2,3}(?:地檢署|地方法院|高等法院)/g,
  /[一-鿿]{2,3}(?:路|街|大道|夜市|車站|轉運站|機場|醫院|大學|國中|國小|園區)/g,
  /KK園區|柬埔寨|緬甸|杜拜/g,
];
// 抽出後剝除的前導虛字（避免「在中山路」這種把動介詞吃進實體）。
const LEAD_PARTICLE = new Set("在於到至向往從由並且也是與和的了對把被將為因經當且赴於".split(""));
// 標題 bigram 去噪：泛用詞不計入「相似」分數。
const STOP_BIGRAM = new Set([
  "警方", "今天", "昨天", "記者", "報導", "新聞", "表示", "指出", "目前", "發生",
  "造成", "一名", "男子", "女子", "嫌犯", "涉嫌", "遭到", "進行", "結果", "如何",
  "詐騙", "詐欺", "匯款", "投資", "交友", "假投", "假交", "萬元", "百萬", "十萬",
]);

const GENERIC_AI_ENTITIES = new Set([
  "警方", "警察", "警局", "警政署", "刑事局", "消防局", "消防署", "海巡署", "移民署",
  "檢方", "檢警", "檢調", "法院", "地檢署", "地方法院", "高等法院", "調查局",
  "車手", "銀行", "超商", "LINE", "毒駕", "酒駕", "網路", "男子", "女子",
  "高雄市", "臺北市", "台北市", "新北市", "桃園市", "臺中市", "台中市", "臺南市", "台南市",
  "基隆市", "新竹市", "嘉義市", "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣",
  "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "台東縣", "澎湖縣", "金門縣", "連江縣",
  "柬埔寨", "緬甸", "杜拜",
]);

function stripLead(s) {
  let out = s;
  while (out.length > 2 && LEAD_PARTICLE.has(out[0])) out = out.slice(1);
  return out;
}

function isSpecificEntity(entity) {
  const e = String(entity || "").trim();
  if (e.length < 2 || e.length > 14) return false;
  if (GENERIC_AI_ENTITIES.has(e)) return false;
  if (/^[臺台]灣$/.test(e)) return false;
  if (/^[一-鿿]{2,4}[縣市區鄉鎮]$/.test(e)) return false;
  if (/^[一-鿿]姓(?:男子|女子)?$/.test(e)) return false;
  if (/(地檢署|地方法院|高等法院|法院|地院|法務部)$/.test(e)) return false;
  return true;
}

function matchLexicon(text) {
  const tags = new Set();
  for (const [re, tag] of LEXICON) if (re.test(text)) tags.add(tag);
  return tags;
}

function matchEntities(text) {
  const ents = new Set();
  for (const re of ENTITY_PATTERNS) {
    const ms = text.match(re);
    if (ms) {
      for (const m of ms) {
        const ent = stripLead(m);
        if (isSpecificEntity(ent)) ents.add(ent);
      }
    }
  }
  return ents;
}

function cjkBigrams(text, region) {
  const regionText = String(region || "");
  let cleaned = String(text || "").replace(new RegExp(regionText || "__NO_REGION__", "g"), "");
  if (regionText.length > 1 && /[縣市]$/.test(regionText)) {
    cleaned = cleaned.replace(new RegExp(regionText.slice(0, -1), "g"), "");
  }
  const bigrams = new Set();
  const runs = cleaned.match(/[一-鿿]{2,}/g) || [];
  for (const run of runs) {
    for (let i = 0; i + 2 <= run.length; i++) {
      const bg = run.slice(i, i + 2);
      if (!STOP_BIGRAM.has(bg)) bigrams.add(bg);
    }
  }
  return bigrams;
}

function toMs(iso) {
  const d = new Date(iso);
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

// 從單一事件抽出關聯訊號。
export function extractSignals(event) {
  const text = `${event.title || ""} ${event.summary || ""}`;
  const entities = matchEntities(text);
  // 併入 LLM 萃取的具名實體（語意關聯：跨來源、不同用詞也能對上同一專名）。
  if (Array.isArray(event.aiEntities)) {
    for (const ent of event.aiEntities) {
      const e = String(ent || "").trim();
      if (isSpecificEntity(e)) entities.add(e);
    }
  }
  return {
    id: event.id,
    region: event.region || "全國",
    category: event.category || "",
    scope: event.scope || "domestic",
    t: toMs(event.timestamp),
    keywords: matchLexicon(text),
    entities,
    bigrams: cjkBigrams(event.title, event.region),
    // LLM 萃取的具體事件/故事線（Pass 3 同題語意連結用）。
    aiTopic: typeof event.aiTopic === "string" ? event.aiTopic.trim() : "",
    sourceName: event.source?.name || "",
    sourceType: event.source?.type || "",
  };
}

function inter(a, b) {
  let n = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (big.has(x)) n++;
  return n;
}

function overlapRatio(shared, aSet, bSet) {
  const base = Math.min(aSet.size, bSet.size);
  return base ? shared / base : 0;
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function sameEntityEdgeEntity(edge) {
  if (edge?.type !== "same-entity") return "";
  return edge.why?.match(/共享實體「(.+?)」/)?.[1] || "";
}

function shouldUnionSameEntity(edge) {
  const ent = sameEntityEdgeEntity(edge);
  return ent ? !SAME_ENTITY_UNION_BLOCKLIST.has(ent) : true;
}

// 把多個候選邊合併（同一對取最高權重，理由併陳）。
function upsertEdge(map, aId, bId, type, weight, why) {
  if (aId === bId) return;
  const key = edgeKey(aId, bId);
  const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
  const cur = map.get(key);
  if (!cur || weight > cur.weight) {
    map.set(key, { a, b, type, weight, why });
  } else if (cur.weight === weight && !cur.why.includes(why)) {
    cur.why = `${cur.why}；${why}`;
  }
}

// 主函式：把事件串成關聯圖。
export function correlateEvents(events, opts = {}) {
  const list = (events || []).filter((e) => e && e.id);
  const sigs = list.map(extractSignals);
  const byId = new Map(sigs.map((s) => [s.id, s]));
  const edges = new Map();

  // ── Pass 1：同縣市區塊內、時間鄰近的配對（same-incident / same-topic）──
  const byRegion = new Map();
  for (const s of sigs) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push(s);
  }
  for (const block of byRegion.values()) {
    block.sort((x, y) => x.t - y.t);
    for (let i = 0; i < block.length; i++) {
      const A = block[i];
      for (let j = i + 1; j < block.length; j++) {
        const B = block[j];
        const dt = B.t - A.t;
        if (dt > PAIR_WINDOW_MS) break; // 已排序，後面只會更遠
        const kw = inter(A.keywords, B.keywords);
        const ent = inter(A.entities, B.entities);
        const bg = inter(A.bigrams, B.bigrams);
        const bgRatio = overlapRatio(bg, A.bigrams, B.bigrams);
        const score = kw + ent + bg;
        const diffSource = A.sourceName !== B.sourceName;
        // 「同地」是強證據：真實縣市內維持寬鬆（score≥2）；「全國」無地理共置，
        // 需更強證據——共享具名實體，或標題用詞重疊 ≥3 個 bigram（真的同一則故事）。
        const strongMatch = ent >= 1 || (bg >= 8 && bgRatio >= 0.6);
        const hasTitleEvidence = ent >= 1 || bg >= 1;
        const incidentOk = VAGUE_REGION.has(A.region)
          ? strongMatch && kw >= 1
          : hasTitleEvidence && kw >= 1 && score >= INCIDENT_MIN_SCORE;
        if (diffSource && dt <= INCIDENT_WINDOW_MS && incidentOk) {
          upsertEdge(edges, A.id, B.id, "same-incident", W_INCIDENT + Math.min(score, 5) * 0.1, "跨源佐證：同地、案類與用詞重疊、時間相近");
        } else if (
          !diffSource &&
          A.category &&
          A.category === B.category &&
          dt <= TOPIC_WINDOW_MS &&
          kw >= 1 &&
          !VAGUE_REGION.has(A.region)
        ) {
          upsertEdge(edges, A.id, B.id, "same-topic", W_TOPIC, "同地同類相關情勢");
        }
      }
    }
  }

  // ── Pass 2：跨地共享具名實體（same-entity），用倒排索引 ──
  const byEntity = new Map();
  for (const s of sigs) {
    for (const ent of s.entities) {
      if (!byEntity.has(ent)) byEntity.set(ent, []);
      byEntity.get(ent).push(s.id);
    }
  }
  let skippedGeneric = 0;
  for (const [ent, ids] of byEntity) {
    if (ids.length < 2) continue;
    if (ids.length > ENTITY_GENERIC_CAP) {
      skippedGeneric++;
      continue;
    }
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++)
        upsertEdge(edges, ids[i], ids[j], "same-entity", W_ENTITY, `共享實體「${ent}」`);
  }

  // ── Pass 3：LLM 萃取的「同題」語意連結（跨來源同一起事件/故事線）──
  // aiTopic 由逐則 LLM 正規化產出；同一具體事件即使各家用詞不同，也能對上，
  // 補足純啟發式（關鍵詞/bigram 重疊）抓不到的語意關聯。
  const byTopic = new Map();
  for (const s of sigs) {
    const topic = s.aiTopic;
    if (!topic || topic.length < 4) continue;
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic).push(s);
  }
  let aiTopicEdges = 0;
  for (const [topic, members] of byTopic) {
    if (members.length < 2 || members.length > ENTITY_GENERIC_CAP) continue;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const A = members[i];
        const B = members[j];
        // 不同來源＝跨源佐證（情報網骨幹）；同來源系列文＝同題弱連結。
        const diffSource = A.sourceName !== B.sourceName;
        const type = diffSource ? "same-incident" : "same-topic";
        const weight = diffSource ? W_INCIDENT + 0.2 : W_TOPIC + 0.1;
        upsertEdge(edges, A.id, B.id, type, weight, `AI 同題：${topic}`);
        aiTopicEdges++;
      }
    }
  }

  const edgeList = [...edges.values()];

  // ── 節點 degree（cluster label 也會用到）──
  const degree = new Map(sigs.map((s) => [s.id, 0]));
  for (const e of edgeList) {
    degree.set(e.a, degree.get(e.a) + 1);
    degree.set(e.b, degree.get(e.b) + 1);
  }
  const eventsById = new Map(list.map((e) => [e.id, e]));
  const tsValue = (e) => {
    const t = Date.parse(e?.timestamp || "");
    return Number.isFinite(t) ? t : 0;
  };
  const topValues = (items, pick, limit = 1) => {
    const counts = new Map();
    const firstSeen = new Map();
    for (const item of items) {
      const value = pick(item);
      if (!value) continue;
      if (!firstSeen.has(value)) firstSeen.set(value, firstSeen.size);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || firstSeen.get(a[0]) - firstSeen.get(b[0]))
      .slice(0, limit)
      .map(([value]) => value);
  };
  const describeCluster = (members, id) => {
    const items = members.map((memberId) => eventsById.get(memberId)).filter(Boolean);
    const representative = items
      .slice()
      .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || tsValue(b) - tsValue(a))[0];
    const latest = items.slice().sort((a, b) => tsValue(b) - tsValue(a))[0];
    const sources = new Set(items.map((e) => e?.source?.name).filter(Boolean));
    const categoryCounts = new Map();
    const topics = new Set();
    const timestamps = [];
    for (const e of items) {
      if (e?.category) categoryCounts.set(e.category, (categoryCounts.get(e.category) || 0) + 1);
      if (e?.aiTopic) topics.add(e.aiTopic);
      const t = tsValue(e);
      if (t > 0) timestamps.push(t);
    }
    const maxCategoryCount = categoryCounts.size ? Math.max(...categoryCounts.values()) : 0;
    const dominantCategoryShare = items.length ? maxCategoryCount / items.length : 0;
    let categoryEntropy = 0;
    for (const count of categoryCounts.values()) {
      const p = count / items.length;
      categoryEntropy -= p * Math.log2(p);
    }
    const distinctTopicRatio = items.length ? topics.size / items.length : 0;
    const temporalSpanDays = timestamps.length >= 2 ? (Math.max(...timestamps) - Math.min(...timestamps)) / DAY : 0;
    const highEntropyMultiTopic =
      categoryEntropy >= CLUSTER_INCOHERENT_CATEGORY_ENTROPY && distinctTopicRatio >= CLUSTER_INCOHERENT_TOPIC_RATIO;
    return {
      id,
      members,
      size: members.length,
      representativeTitle: representative?.title || "",
      topCategory: topValues(items, (e) => e.category, 1)[0] || "",
      regions: topValues(items, (e) => e.region, 2),
      latestTs: latest?.timestamp || "",
      sourceCount: sources.size,
      dominantCategoryShare,
      categoryEntropy,
      distinctTopicRatio,
      temporalSpanDays,
      incoherent: dominantCategoryShare < CLUSTER_INCOHERENT_DOMINANT_SHARE || highEntropyMultiTopic,
    };
  };

  // ── 連通分量（union-find）→ clusters ──
  const parent = new Map(sigs.map((s) => [s.id, s.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  let skippedSameEntityUnionEdges = 0;
  for (const e of edgeList) {
    if (
      (e.type === "same-entity" && shouldUnionSameEntity(e)) ||
      (e.type === "same-incident" && e.weight >= CLUSTER_INCIDENT_MIN_WEIGHT)
    ) {
      union(e.a, e.b);
    } else if (e.type === "same-entity") {
      skippedSameEntityUnionEdges++;
    }
  }
  const groups = new Map();
  for (const s of sigs) {
    const r = find(s.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(s.id);
  }
  const clusters = [...groups.values()]
    .filter((m) => m.length >= 2)
    .map((members, i) => describeCluster(members, `c${i}`))
    .sort((a, b) => b.size - a.size);

  // ── 節點（含 degree）──
  const nodes = list.map((e) => ({
    id: e.id,
    region: e.region,
    category: e.category,
    riskLevel: e.riskLevel,
    scope: e.scope,
    degree: degree.get(e.id) || 0,
  }));

  const byType = { "same-incident": 0, "same-entity": 0, "same-topic": 0 };
  for (const e of edgeList) byType[e.type] = (byType[e.type] || 0) + 1;

  return {
    nodes,
    edges: edgeList,
    clusters,
    stats: {
      events: list.length,
      edges: edgeList.length,
      byType,
      clusters: clusters.length,
      largestCluster: clusters[0]?.size || 0,
      skippedGenericEntities: skippedGeneric,
      skippedSameEntityUnionEdges,
      aiTopicEdges,
    },
  };
}

// 情報網聚焦在「新聞類」事件（~90 條 RSS 與 tw-news）。政府統計/點位資料（竊盜點位、
// 路口錄監、集會遊行…）標題高度模板化，納入會把網黏成毛球，故排除在外。
export function isNewsLikeEvent(e) {
  return e?.source?.type === "news-rss" || e?.source?.datasetId === "tw-news";
}

// 取某事件的相連事件，依權重高→低排序。
export function relatedIds(network, id, limit = 20) {
  const out = [];
  for (const e of network.edges) {
    if (e.a === id) out.push({ id: e.b, type: e.type, weight: e.weight, why: e.why });
    else if (e.b === id) out.push({ id: e.a, type: e.type, weight: e.weight, why: e.why });
  }
  out.sort((x, y) => y.weight - x.weight);
  return out.slice(0, limit);
}
