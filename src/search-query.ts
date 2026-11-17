import { SEARCH_TOPICS } from "./search-topics";

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
  const cleaned = text
    .replace(/近\s*(\d+)\s*天|(\d+)\s*天內|今天|今日|昨天|最近|近期|這幾天|本週|這週|這禮拜|本月|這個月/gu, (word, before, after) => {
      windows.push(before || after ? Math.max(1, Math.min(30, Number(before || after))) : timeWords[word]);
      return " ";
    })
    .replace(/我想看|有哪些|有什麼|給我|幫我|相關|新聞|消息|一下|的|嗎/gu, " ")
    // 保留「查獲」等實際關鍵字；單字指令只在詞首或獨立出現時移除。
    .replace(/(^|[\s\p{P}])(?:查(?!獲|緝|扣)|找)/gu, "$1");
  const terms = [...new Set(cleaned.split(/[\s\p{P}\p{S}]+/u).filter(Boolean))];
  const groups = terms.map(term => {
    const group = new Set([term]);
    for (const [topic, synonyms] of Object.entries(SEARCH_TOPICS)) {
      if ([topic, ...synonyms].some(word => word.toLocaleLowerCase("zh-TW") === term.toLocaleLowerCase("zh-TW"))) {
        group.add(topic);
        for (const word of synonyms) group.add(word);
      }
    }
    return [...group];
  });
  return { raw: text, terms, expanded: [...new Set(groups.flat())], groups, windowDays: windows.length ? Math.min(...windows) : null };
}
