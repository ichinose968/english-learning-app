// 文法問題データベースの取得と出題キューの構築
import { GrammarDb, GrammarDbItem, Level } from "./types";

export async function fetchGrammarDb(level: Level): Promise<GrammarDb> {
  const res = await fetch(`/english-grammar/${level}.json`);
  // **そのレベルの文法DBがまだ無くても落とさない** (単語DBと同じ扱い)。
  // レベルを足した直後は単語だけ先にあることがある
  if (res.status === 404) {
    return { level, generatedAt: "", count: 0, items: [] };
  }
  if (!res.ok) {
    throw new Error(
      "文法問題データベースが見つかりません。`node scripts/generate-english-grammar.mjs` を実行して生成してください。",
    );
  }
  return (await res.json()) as GrammarDb;
}

// 複数レベルをまとめて1つの出題プールにする
export interface GrammarPool {
  levels: Level[];
  items: GrammarDbItem[];
}

export async function fetchGrammarPool(levels: Level[]): Promise<GrammarPool> {
  const dbs = await Promise.all(levels.map(fetchGrammarDb));
  return { levels, items: dbs.flatMap((d) => d.items) };
}

function weightedSample<T>(pool: { item: T; w: number }[], count: number): T[] {
  const result: T[] = [];
  const rest = [...pool];
  while (result.length < count && rest.length > 0) {
    const total = rest.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < rest.length; i++) {
      r -= rest[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    result.push(rest[idx].item);
    rest.splice(idx, 1);
  }
  return result;
}

// 出題キューを組む。
// - topics を指定するとそのトピックだけ (複数可)。空ならおまかせで、苦手トピックを重み3で優先
// - 未出題の問題を優先し、足りなければ出題済みから補充する
export function buildGrammarQueue(
  items: GrammarDbItem[],
  topics: string[],
  weakTopics: string[],
  seenIds: string[],
  size: number,
): GrammarDbItem[] {
  const seen = new Set(seenIds);
  const pool =
    topics.length > 0 ? items.filter((it) => topics.includes(it.topic)) : items;

  const toWeighted = (items: GrammarDbItem[]) =>
    items.map((item) => ({
      item,
      w: topics.length === 0 && weakTopics.includes(item.topic) ? 3 : 1,
    }));

  const unseen = pool.filter((it) => !seen.has(it.id));
  const queue = weightedSample(toWeighted(unseen), size);

  if (queue.length < size) {
    const used = new Set(queue.map((q) => q.id));
    const fill = pool.filter((it) => !used.has(it.id));
    queue.push(...weightedSample(toWeighted(fill), size - queue.length));
  }
  return queue;
}
