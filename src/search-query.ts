import { SEARCH_TOPICS } from "./search-topics";
import type { IntelEvent } from "./types/event";

// 名稱裡含時間詞或填充詞的媒體，整段當關鍵字，不拆出時間窗（長的放前面）。
const LITERAL_NAMES = ["NOWnews今日新聞", "今日新聞"];

export interface SearchQuery {
  raw: string;
  terms: string[];
  expanded: string[];
  /** 每個詞（含其主題同義詞）一組；搜尋時各組都要命中。 */
  groups: string[][];
  windowDays: number | null;
}

export function parseSearchQuery(text: string): SearchQuery {
  const windows: number[] = [];
  const timeWords: Record<string, number> = {
    今天: 1, 今日: 1, 昨天: 2,
    最近: 7, 近期: 7, 這幾天: 7, 本週: 7, 這週: 7, 這禮拜: 7,
    本月: 30, 這個月: 30,
  };
  const literals: string[] = [];
  const protectedText = LITERAL_NAMES.reduce((acc, name) => acc.split(name).join(` ${literals.push(name) - 1} `), text);
  const cleaned = protectedText
    .replace(/近\s*(\d+)\s*天|(\d+)\s*天內|今天|今日|昨天|最近|近期|這幾天|本週|這週|這禮拜|本月|這個月/gu, (word, before, after) => {
      windows.push(before || after ? Math.max(1, Math.min(30, Number(before || after))) : timeWords[word]);
      return " ";
    })
    .replace(/我想看|有哪些|有什麼|給我|幫我|相關|新聞|消息|一下|的|嗎/gu, " ")
    // 保留「查獲」等實際關鍵字；單字指令只在詞首或獨立出現時移除。
    .replace(/(^|[\s\p{P}])(?:查(?!獲|緝|扣)|找)/gu, "$1");
  const terms = [...new Set(cleaned.split(/[\s\p{P}\p{S}]+/u).filter(Boolean)
    .map(term => term.replace(/(\d+)/gu, (_, i) => literals[Number(i)])))];
  // 只有主題名（如「交通」）才擴大成同義詞；具體詞（如「車禍」）照字面搜，避免被放大成整個主題。
  const groups = terms.map(term => [term, ...(Object.hasOwn(SEARCH_TOPICS, term) ? SEARCH_TOPICS[term] : [])]);
  return { raw: text, terms, expanded: [...new Set(groups.flat())], groups, windowDays: windows.length ? Math.min(...windows) : null };
}

// 「臺北」與「台北」視為同字。
const fold = (text: string) => text.toLocaleLowerCase("zh-TW").replaceAll("臺", "台");

/** 事件是否符合解析後的搜尋：時間窗內，且每個詞（含同義詞）都命中。回傳不符原因，符合回 null。 */
export function searchMismatch(e: IntelEvent, parsed: SearchQuery, now = Date.now()): "time" | "terms" | null {
  if (parsed.windowDays !== null) {
    const timestamp = Date.parse(e.timestamp);
    if (!(timestamp >= now - parsed.windowDays * 86_400_000 && timestamp <= now)) return "time";
  }
  const hay = fold(`${e.title} ${e.summary} ${e.region} ${e.category} ${e.source.name}`);
  const hit = parsed.groups.every(group => group.some(term => hay.includes(fold(term))));
  return hit ? null : "terms";
}
