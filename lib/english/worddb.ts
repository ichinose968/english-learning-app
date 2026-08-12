// 単語データベースの取得と、学習進捗に基づく出題キューの構築
import {
  CardSource,
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

// 単語帳の部門。語彙とイディオムでDBと出題を分ける (学習記録は共通ストア)
export type DbKind = "words" | "idioms";

const DB_PATH: Record<DbKind, string> = {
  words: "english-words",
  idioms: "english-idioms",
};

async function fetchWordDb(kind: DbKind, level: Level): Promise<WordDb> {
  const res = await fetch(`/${DB_PATH[kind]}/${level}.json`);
  if (!res.ok) {
    throw new Error(
      kind === "words"
        ? "単語データベースが見つかりません。`node scripts/generate-english-words.mjs` を実行して生成してください。"
        : "イディオムデータベースが見つかりません。生成ワークフローの完了とマージを確認してください。",
    );
  }
  return (await res.json()) as WordDb;
}

// 全レベルのDBをまとめて読み込む (レベル測定と多レベル復習に使う)。
// source が "both" のときは語彙とイディオムをレベルごとに結合する
export async function fetchAllWordDbs(
  source: CardSource = "words",
): Promise<WordDbMap> {
  if (source !== "both") {
    const dbs = await Promise.all(LEVELS.map((l) => fetchWordDb(source, l.key)));
    return Object.fromEntries(dbs.map((db) => [db.level, db])) as WordDbMap;
  }
  const [words, idioms] = await Promise.all([
    fetchAllWordDbs("words"),
    fetchAllWordDbs("idioms"),
  ]);
  return Object.fromEntries(
    LEVEL_ORDER.map((lv) => [
      lv,
      {
        level: lv,
        generatedAt: words[lv].generatedAt,
        count: words[lv].count + idioms[lv].count,
        words: [...words[lv].words, ...idioms[lv].words],
      },
    ]),
  ) as WordDbMap;
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
  | "stale" // 習得済みだが最終正解が古い → 再出現
  | "preknown"; // 初見で「知っている」→ 既知の知識として永久に出題しない (設定オン時)

// ステータスの表示名と配色。単語一覧とカード詳細で必ず同じものを使う
// (以前ここが二重定義になっていて「既知」と「学習済み」が食い違った)
export const STATUS_BADGE: Record<WordStatus, { label: string; cls: string }> = {
  new: {
    label: "未学習",
    cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  },
  learning: { label: "学習中", cls: "bg-yellow-500/15 text-yellow-500" },
  review: { label: "要復習", cls: "bg-red-500/15 text-red-500" },
  stale: { label: "再出現待ち", cls: "bg-red-500/15 text-red-500" },
  mastered: { label: "学習済み", cls: "bg-[#4A99EA]/15 text-[#4A99EA]" },
  // 初見で○を選んで除外したものは「既知」。学習の結果ではなく元から知っていた語
  preknown: { label: "既知", cls: "bg-[#4A99EA]/15 text-[#4A99EA]" },
};

function daysBetween(fromIso: string, now: Date): number {
  return (now.getTime() - new Date(fromIso).getTime()) / (1000 * 60 * 60 * 24);
}

// 初見で「知っている」と答え、その後一度も間違えていない単語か
// (履歴から動的に判定するので、設定をオフに戻せば通常ローテーションに復帰する)
export function isPreKnown(entry: VocabEntry, settings: VocabSettings): boolean {
  return (
    settings.excludeFirstKnown &&
    entry.history.length > 0 &&
    entry.history[0].r === "known" &&
    entry.wrongCount + entry.unknownCount === 0
  );
}

// 直近から連続して「知っている」と答え続けている回数。
// ? や × を選んだ時点で 0 に戻る (履歴を持たない旧形式の記録は累計で近似する)
export function consecutiveKnown(entry: VocabEntry): number {
  if (entry.history.length === 0) return entry.knownCount;
  let n = 0;
  for (let i = entry.history.length - 1; i >= 0; i--) {
    if (entry.history[i].r !== "known") break;
    n++;
  }
  return n;
}

export function wordStatus(
  entry: VocabEntry | undefined,
  settings: VocabSettings,
  now: Date,
): WordStatus {
  if (!entry) return "new";
  // 手で付け替えたステータスは学習記録より優先する
  if (entry.statusOverride) return entry.statusOverride;
  if (isPreKnown(entry, settings)) return "preknown";
  if (entry.needsReview) return "review";
  // 最終閲覧からの経過日数で再出現を判定する (null なら再出現させない)
  const staleByDate =
    settings.reviewIntervalDays !== null &&
    daysBetween(entry.lastSeenAt, now) > settings.reviewIntervalDays;
  if (consecutiveKnown(entry) >= settings.masterKnownCount) {
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

// 上部タブの件数はここから引く。各項目は buildQueue が同じモードで拾う範囲と一致させる
export interface QueueStats {
  new: number; // 出題対象レベルの未学習
  learning: number; // 以下は学習履歴のある全単語 (レベル横断)
  review: number;
  mastered: number;
  stale: number;
  preknown: number; // 初見で「既知」として除外した数
  mistaken: number; // 間違えたことのある数
}

export function dbStats(
  dbs: WordDbMap,
  levels: Level[],
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
    preknown: 0,
    mistaken: 0,
  };
  // 未学習だけは学習履歴がないので、出題対象レベルのDBから数える
  for (const level of levels) {
    for (const w of dbs[level].words) {
      if (wordStatus(progress[w.word], settings, now) === "new") stats.new++;
    }
  }
  // 残りは学習履歴のある全単語 (レベル横断) で数える
  const index = buildIndex(dbs);
  for (const entry of Object.values(progress)) {
    if (!index.has(entry.word)) continue;
    const s = wordStatus(entry, settings, now);
    if (s === "learning" || s === "mastered" || s === "preknown") stats[s]++;
    if (s === "review") stats.review++;
    if (s === "stale") stats.stale++;
    if (entry.wrongCount + entry.unknownCount > 0) stats.mistaken++;
  }
  return stats;
}

// ---- 過去時点の統計 (先週比の算出用) ----

// 回答履歴を asOf 時点まで巻き戻したエントリを作る。
// その時点でまだ一度も学習していなければ undefined (= 未学習) を返す
export function entryAsOf(entry: VocabEntry, asOf: Date): VocabEntry | undefined {
  // 履歴を持たない旧形式の記録は最終学習日時で近似する
  if (entry.history.length === 0) {
    return new Date(entry.lastSeenAt) <= asOf ? entry : undefined;
  }
  const past = entry.history.filter((h) => new Date(h.t) <= asOf);
  if (past.length === 0) return undefined;

  let knownCount = 0;
  let unsureCount = 0;
  let unknownCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  for (const h of past) {
    if (h.r === "known") {
      knownCount++;
    } else if (h.r === "unsure_correct") {
      unsureCount++;
      correctCount++;
    } else if (h.r === "unsure_wrong") {
      unsureCount++;
      wrongCount++;
    } else {
      unknownCount++;
    }
  }
  const last = past[past.length - 1];
  return {
    ...entry,
    knownCount,
    unsureCount,
    unknownCount,
    correctCount,
    wrongCount,
    needsReview: last.r === "unsure_wrong" || last.r === "unknown",
    lastSeenAt: last.t,
    history: past,
  };
}

export function dbStatsAsOf(
  dbs: WordDbMap,
  levels: Level[],
  progress: Record<string, VocabEntry>,
  settings: VocabSettings,
  asOf: Date,
): QueueStats {
  const pastProgress: Record<string, VocabEntry> = {};
  for (const [word, entry] of Object.entries(progress)) {
    const p = entryAsOf(entry, asOf);
    if (p) pastProgress[word] = p;
  }
  return dbStats(dbs, levels, pastProgress, settings, asOf);
}

// 出題モード。ランダム以外はカード画面の上部タブのカテゴリと1対1で対応する
// - random: 現在レベルの出題対象すべて (未学習・学習中・要復習) を混ぜる。要復習を最大4割
// - review: 要復習 + 再出現待ち (学習履歴のある全レベルから)
// - new: 現在レベルの未学習のみ (履歴がないので現在レベルのDBから取る)
// - learning: 学習中 (学習履歴のある全レベルから)
// - mastered: 学習済み。初見で除外したもの (preknown) も含む (全レベルから)
export type QuizMode = "random" | "review" | "new" | "learning" | "mastered";

export function buildQueue(
  dbs: WordDbMap,
  levels: Level[],
  progress: Record<string, VocabEntry>,
  settings: VocabSettings,
  mode: QuizMode,
  size: number,
  now: Date,
  exclude: Set<string> = new Set(),
): WordDbEntry[] {
  const index = buildIndex(dbs);

  // 学習履歴のある単語 (全レベル横断) を状態ごとに仕分ける
  const due: { item: WordDbEntry; w: number }[] = [];
  const inProgress: { item: WordDbEntry; w: number }[] = [];
  const done: { item: WordDbEntry; w: number }[] = [];
  for (const entry of Object.values(progress)) {
    const info = index.get(entry.word);
    if (!info || exclude.has(info.def.word)) continue;
    const status = wordStatus(entry, settings, now);
    const pick = { item: info.def, w: weight(entry, status) };
    if (status === "review" || status === "stale") due.push(pick);
    else if (status === "learning") inProgress.push(pick);
    else if (status === "mastered" || status === "preknown") done.push(pick);
  }

  if (mode === "review") return weightedSample(due, size);
  if (mode === "learning") return weightedSample(inProgress, size);
  if (mode === "mastered") return weightedSample(done, size);

  // 出題対象レベルの未学習・学習中 (ランダム出題の素材)
  const fresh: { item: WordDbEntry; w: number }[] = [];
  const levelLearning: { item: WordDbEntry; w: number }[] = [];
  for (const level of levels) {
    for (const w of dbs[level].words) {
      if (exclude.has(w.word)) continue;
      const entry = progress[w.word];
      const status = wordStatus(entry, settings, now);
      if (status === "new") fresh.push({ item: w, w: 1 });
      if (status === "learning")
        levelLearning.push({ item: w, w: weight(entry, status) });
    }
  }

  if (mode === "new") {
    return weightedSample(fresh, size);
  }

  const dueCount = Math.min(due.length, Math.floor(size * 0.4));
  const queue = weightedSample(due, dueCount);
  queue.push(...weightedSample(fresh, size - queue.length));

  if (queue.length < size) {
    const used = new Set(queue.map((q) => q.word));
    const fill = [...levelLearning, ...due].filter((p) => !used.has(p.item.word));
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
