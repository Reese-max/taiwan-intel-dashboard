// 標題正規化鍵：去掉「 - 媒體名／｜媒體名」尾綴與所有非中英數字元，用於跨來源/跨查詢去重。
const KNOWN_NEWS_TAIL = /^(?:社會|社會新聞|社會萬象|社會焦點|政治|政治新聞|政治焦點|國際|國際焦點|兩岸|地方|地方新聞|綜合|時事|要聞|生活|生活新聞|司法|法律前線|財經|財經焦點|產業|產業熱點|科技產業|產經|娛樂|娛樂星聞|體育|全球|新聞|焦點事件|詐騙小心點|縣市長議員選戰|2026九合一選舉|情慾犯罪|熱門話題|政經焦點|選舉|教育|星聞|世界萬象|兩岸要聞|基宜花東|政府消息新聞|CTWANT|太報|自由時報|自由電子報|民視新聞網|鏡週刊|鏡新聞|#鏡新聞|TVBS|TVBS新聞|華視新聞|EBC 東森新聞|東森新聞|三立新聞網|中華日報|青年日報|中央社|中央廣播電臺|聯合新聞網|中廣新聞網|桃園電子報|科技新報|NOWNEWS今日新聞|ETtoday(?:新聞雲|星光雲)?|Yahoo奇摩(?:新聞)?|中時新聞網|中國時報|上報|新頭殼|Newtalk|MSN|MoneyDJ理財網|觀傳媒|台灣好新聞|信傳媒|公視新聞PNN|勁報|墨新聞|公視新聞網|股市爆料同學會)$/iu;
const NEWS_TAIL_SEPARATOR = /(?:-\s+|[|｜]\s*|\s+[–—]\s*)([^\-|｜–—]{1,40})$/u;

export function cleanNewsTitleTail(title) {
  let value = String(title || "").trim();
  value = value.replace(/^討論牆\s*[|｜]\s*/u, "");
  let previous;
  do {
    previous = value;
    const suffix = value.match(NEWS_TAIL_SEPARATOR);
    if (suffix && KNOWN_NEWS_TAIL.test(suffix[1].trim())) value = value.slice(0, suffix.index).trim();
  } while (value !== previous);
  return value;
}

export function titleKey(title) {
  return String(title || "")
    .replace(/\s*[-|｜–—]\s*[^-|｜–—]{1,20}$/, "")
    .replace(/[^一-鿿A-Za-z0-9]/g, "")
    .toLowerCase();
}

export function dedupeTitleKey(title) {
  let value = String(title || "").trim();
  value = value.replace(/^(?:(?:快訊|影|影音|獨家|最新|即時|更新|直播|討論牆)(?:\s*[／/：:｜|]\s*|\s+-\s*|\s+))+/u, "");
  value = cleanNewsTitleTail(value);
  return value.replace(/[^一-鿿A-Za-z0-9]/g, "").toLowerCase();
}

