// 単語データベースの取得と、学習進捗に基づく出題キューの構築
import {
  Level,
  LEVELS,
  VocabEntry,
  VocabLevelState,
  VocabSettings,
  WordDb,
  WordDbEntry,
} from "./types";

export const LEVEL_ORDER: Level[] = ["A1", "A2", "B1", "B2", "C1"];

export type WordDbMap = Record<Level, WordDb>;

async function fetchWordDb(level: Level): Promise<WordDb> {
  const res = await fetch(`/english-words/${level}.json`);
  if (!res.ok) {
    throw new Error(
      "単語データベースが見つかりません。`node scripts/generate-english-words.mjs` を実行して生成してください。",
    );
  }
  return (await res.json()) as WordDb;
}

// 全レベルのDBをまとめて読み込む (計500KB程度。レベル測定と多レベル復習に使う)
export async function fetchAllWordDbs(): Promise<WordDbMap> {
  const dbs = await Promise.all(LEVELS.map((l) => fetchWordDb(l.key)));
  return Object.fromEntries(dbs.map((db) => [db.level, db])) as WordDbMap;
}

// word → 定義とレベルの索引 (復習単語は現在のレベル以外からも出題するため)
export function buildIndex(
  dbs: WordDbMap,
): Map<string, { def: WordDbEntry; level: Level }> {
  const index = new Map<string, { def: WordDbEntry; level: Level }>();
  for (const level of LEVEL_ORDER) {
    for (const w of dbs[level].words) {
      if (!index.has(w.word)) index.set(w.word, { def: w, level });
    }
  }
  return index;
}

export type WordStatus =
  | "new" // 未学習
  | "learning" // 学習中
  | "review" // 要復習 (直近が誤答/知らない)
  | "mastered" // 習得済み (「知っている」がしきい値以上) → 出題除外
  | "stale"; // 習得済みだが最終正解が古い → 再出現

function daysBetween(fromIso: string, now: Date): number {
  return (now.getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24);
}

export function wordStatus(
  entry: VocabEntry | undefined,
  settings: VocabSettings,
  now: Date,
): WordStatus {
  if (!entry) return "new";
  if (entry.needsReview) return "review";
  const staleByDate =
    entry.lastCorrectAt !== null &&
    daysBetween(entry.lastCorrectAt, now) > settings.reviewIntervalDays;
  if (entry.knownCount >= settings.masterKnownCount) {
    return staleByDate ? "stale" : "mastered";
  }
  return staleByDate ? "stale" : "learning";
}

// 間違い (4択誤答 + 知らない) が多い単語ほど重みを大きくする
function weight(entry: VocabEntry | undefined, status: WordStatus): number {
  const mistakes = entry ? entry.wrongCount + entry.unknownCount : 0;
  let w = 1 + mistakes * 2;
  if (status === "review") w += 3;
  if (status === "stale") w += 1;
  return w;
}

// 重み付きランダム抽選 (非復元)
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

export interface QueueStats {
  new: number; // 現在レベルの未学習
  learning: number;
  review: number; // 全レベル横断
  mastered: number;
  stale: number;
  mistaken: number; // 苦手演習の対象数 (全レベル横断)
}

export function dbStats(
  dbs: WordDbMap,
  currentLevel: Level,
  progress: Record<string, VocabEntry>,
  settings: VocabSettings,
  now: Date,
): QueueStats {
  const stats: QueueStats = {
    new: 0,
    learning: 0,
    review: 0,
    mastered: 0,
    stale: 0,
    mistaken: 0,
  };
  // 現在レベルのDBを基準に new/learning/mastered を数える
  for (const w of dbs[currentLevel].words) {
    const s = wordStatus(progress[w.word], settings, now);
    if (s === "new" || s === "learning" || s === "mastered") stats[s]++;
  }
  // 要復習・再出現・苦手は学習履歴のある全単語 (レベル横断) で数える
  const index = buildIndex(dbs);
  for (const entry of Object.values(progress)) {
    if (!index.has(entry.word)) continue;
    const s = wordStatus(entry, settings, now);
    if (s === "review") stats.review++;
    if (s === "stale") stats.stale++;
    if (entry.wrongCount + entry.unknownCount > 0) stats.mistaken++;
  }
  return stats;
}

// 出題キューを組む。
// - normal: 要復習・再出現分 (全レベル横断) を最大4割、残りは現在レベルの未学習から
// - weak: 間違えたことのある単語のみ (全レベル横断、重み付き)
export function buildQueue(
  dbs: WordDbMap,
  currentLevel: Level,
  progress: Record<string, VocabEntry>,
  settings: VocabSettings,
  mode: "normal" | "weak",
  size: number,
  now: Date,
): WordDbEntry[] {
  const index = buildIndex(dbs);

  // 学習履歴のある単語 (全レベル横断)
  const due: { item: WordDbEntry; w: number }[] = [];
  const mistaken: { item: WordDbEntry; w: number }[] = [];
  for (const entry of Object.values(progress)) {
    const info = index.get(entry.word);
    if (!info) continue;
    const status = wordStatus(entry, settings, now);
    if (status === "review" || status === "stale") {
      due.push({ item: info.def, w: weight(entry, status) });
    }
    if (entry.wrongCount + entry.unknownCount > 0) {
      mistaken.push({ item: info.def, w: weight(entry, status) });
    }
  }

  if (mode === "weak") {
    return weightedSample(mistaken, size);
  }

  // 現在レベルの未学習・学習中
  const fresh: { item: WordDbEntry; w: number }[] = [];
  const learning: { item: WordDbEntry; w: number }[] = [];
  for (const w of dbs[currentLevel].words) {
    const entry = progress[w.word];
    const status = wordStatus(entry, settings, now);
    if (status === "new") fresh.push({ item: w, w: 1 });
    if (status === "learning") learning.push({ item: w, w: weight(entry, status) });
  }

  const dueCount = Math.min(due.length, Math.floor(size * 0.4));
  const queue = weightedSample(due, dueCount);
  queue.push(...weightedSample(fresh, size - queue.length));

  if (queue.length < size) {
    const used = new Set(queue.map((q) => q.word));
    const fill = [...learning, ...due].filter((p) => !used.has(p.item.word));
    queue.push(...weightedSample(fill, size - queue.length));
  }

  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  return queue;
}

// ---- 初回レベル測定 (階段方式) ----

export const PLACEMENT_SIZE = 10;

// 現在の段のレベルから未出題の単語を1つ選ぶ
export function samplePlacementWord(
  dbs: WordDbMap,
  level: Level,
  exclude: Set<string>,
): WordDbEntry | null {
  const cands = dbs[level].words.filter((w) => !exclude.has(w.word));
  if (cands.length === 0) return null;
  return cands[Math.floor(Math.random() * cands.length)];
}

// 各回答後の段の推移から判定する (序盤は探索なので後半6回の平均を使う)
export function estimatePlacement(track: number[]): Level {
  const tail = track.slice(-6);
  const avg = tail.reduce((s, x) => s + x, 0) / Math.max(1, tail.length);
  return LEVEL_ORDER[Math.max(0, Math.min(4, Math.round(avg)))];
}

// ---- 正解率によるレベルの動的調整 ----

export const LEVEL_SHIFT_WINDOW = 20; // 直近何問を見るか
export const LEVEL_SHIFT_MIN = 10; // 判定に必要な最低問数
export const LEVEL_UP_ACC = 0.85; // これ以上でレベルアップ
export const LEVEL_DOWN_ACC = 0.5; // これ以下でレベルダウン

export function evaluateLevelShift(
  state: VocabLevelState,
): { next: Level; direction: "up" | "down"; acc: number } | null {
  if (state.current === null || state.recent.length < LEVEL_SHIFT_MIN) return null;
  const acc = state.recent.filter(Boolean).length / state.recent.length;
  const i = LEVEL_ORDER.indexOf(state.current);
  if (acc >= LEVEL_UP_ACC && i < LEVEL_ORDER.length - 1) {
    return { next: LEVEL_ORDER[i + 1], direction: "up", acc };
  }
  if (acc <= LEVEL_DOWN_ACC && i > 0) {
    return { next: LEVEL_ORDER[i - 1], direction: "down", acc };
  }
  return null;
}
