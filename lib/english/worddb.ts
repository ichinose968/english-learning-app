// 単語データベースの取得と、学習進捗に基づく出題キューの構築
import {
  CardSource,
  Level,
  LEVELS,
  QuizMode,
  LastResult,
  Progress,
  VocabAction,
  VocabEntry,
  VocabLevelState,
  VocabSettings,
  WordDb,
  WordDbEntry,
} from "./types";

// 出題モードと単語の状態は types.ts 側に置いてある (VocabSettings などが参照するため)。
// 呼び出し側は worddb からも引けるようにしておく
export type { QuizMode, LastResult, Progress };

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

// 前回結果の表示名と配色。○=青 / △=黄 / ×=赤
export const RESULT_BADGE: Record<LastResult, { label: string; cls: string }> = {
  known: { label: "○", cls: "bg-[#4A99EA]/15 text-[#4A99EA]" },
  fuzzy: { label: "△", cls: "bg-yellow-500/15 text-yellow-500" },
  unknown: { label: "×", cls: "bg-red-500/15 text-red-500" },
};

// 学習進捗度の表示名と配色。未学習=白 / 学習中=灰 / 学習完了=黒。
// 進むほど濃くなる並びだが、この画面は常にダークなので黒が地に沈む。
// どれも枠線を持たせて、塗りつぶしの輪郭が出るようにしてある
export const PROGRESS_BADGE: Record<Progress, { label: string; cls: string }> = {
  new: { label: "未学習", cls: "border border-zinc-300 bg-white text-zinc-900" },
  learning: {
    label: "学習中",
    cls: "border border-zinc-400 bg-zinc-400 text-zinc-900",
  },
  done: { label: "学習完了", cls: "border border-zinc-600 bg-black text-white" },
};

// 単語一覧とカード詳細で必ず同じ定義を使う
// (以前ここが二重定義になっていて表示が食い違った)

// 最後に選んだ回答。履歴を持たない旧形式の記録は needsReview から近似する
function lastAction(entry: VocabEntry): VocabAction | null {
  if (entry.history.length > 0) return entry.history[entry.history.length - 1].r;
  if (entry.knownCount + entry.unsureCount + entry.unknownCount === 0) return null;
  return entry.needsReview ? "unknown" : "known";
}

// 直近から連続して ○ が続いている回数。△ や × を選んだ時点で 0 に戻る
// (履歴を持たない旧形式の記録は累計で近似する)
export function consecutiveKnown(entry: VocabEntry): number {
  if (entry.history.length === 0) return entry.knownCount;
  let n = 0;
  for (let i = entry.history.length - 1; i >= 0; i--) {
    if (entry.history[i].r !== "known") break;
    n++;
  }
  return n;
}

// 前回結果。まだ一度も答えていなければ null
export function lastResult(entry: VocabEntry | undefined): LastResult | null {
  if (!entry) return null;
  if (entry.resultOverride) return entry.resultOverride;
  const last = lastAction(entry);
  if (last === null) return null;
  if (last === "known") return "known";
  if (last === "unknown") return "unknown";
  return "fuzzy"; // 4択は正解でも誤答でも △
}

// 学習進捗度。初見で ○ を出した語と、○ が masterKnownCount 回続いた語を学習完了とする。
// ただしどちらも「前回結果が ○」であることが条件で、あとで △ や × を出したら学習中へ戻る。
//
// 初見の判定に △→正解 は含めない。「怪しいが4択は当たった」は身についたとは言えない。
// 戻す条件を付けていないと、一度学習完了になった語は忘れても永久に学習完了のままになり、
// 学習中だけを拾う復習モードに二度と出てこなくなる
export function progressOf(
  entry: VocabEntry | undefined,
  masterKnownCount: number,
): Progress {
  if (!entry) return "new";
  if (entry.progressOverride) return entry.progressOverride;
  if (entry.history.length === 0) {
    // 旧形式の記録は履歴が無い。回答そのものが無ければ未学習
    if (entry.knownCount + entry.unsureCount + entry.unknownCount === 0) {
      return "new";
    }
    return entry.needsReview ? "learning" : "done";
  }
  // 直近が ○ でなければ、この先の判定を見るまでもなく学習中
  if (lastAction(entry) !== "known") return "learning";
  if (entry.history[0].r === "known") return "done";
  if (consecutiveKnown(entry) >= masterKnownCount) return "done";
  return "learning";
}

// カード詳細に渡すステータス。カード画面・単語一覧・長文の3か所で同じものを使う
// (以前ここが画面ごとの組み立てになっていて表示が食い違った)
export function statusBadges(
  entry: VocabEntry | undefined,
  masterKnownCount: number,
): {
  result: { label: string; cls: string; manual: LastResult | null };
  progress: { label: string; cls: string; manual: Progress | null };
} {
  const r = lastResult(entry);
  return {
    result: {
      // 未回答なら前回結果そのものが無いので、ラベルを空にしてバッジを描かせない
      ...(r ? RESULT_BADGE[r] : { label: "", cls: "" }),
      manual: entry?.resultOverride ?? null,
    },
    progress: {
      ...PROGRESS_BADGE[progressOf(entry, masterKnownCount)],
      manual: entry?.progressOverride ?? null,
    },
  };
}

// 復習で引かれやすさを決める重み。**間違えた回数が多い語ほどよく出る。**
// × (知らない) を最も重く、△ はその下に置く。△ の中でも4択まで外した回数 (wrongCount)
// を、当てた回数 (correctCount) より重くする。
// さらに直近の結果を上乗せする。前回 × だった語がいま一番怪しいため。
// 数字を変えるときは scripts/check-english-queue.ts の検算も合わせて直す
export function reviewWeight(entry: VocabEntry | undefined): number {
  if (!entry) return 1;
  let w =
    1 +
    entry.unknownCount * 3 + // ×
    entry.wrongCount * 2 + // △ → 4択で誤答
    entry.correctCount * 1; // △ → 4択で正解 (それでも「怪しい」と答えた証拠)
  const last = lastResult(entry);
  if (last === "unknown") w += 4;
  if (last === "fuzzy") w += 2;
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
  done: number;
  known: number; // 前回結果の内訳
  fuzzy: number;
  unknown: number;
  mistaken: number; // 間違えたことのある数
}

export function dbStats(
  dbs: WordDbMap,
  levels: Level[],
  progress: Record<string, VocabEntry>,
  masterKnownCount: number,
): QueueStats {
  const stats: QueueStats = {
    new: 0,
    learning: 0,
    done: 0,
    known: 0,
    fuzzy: 0,
    unknown: 0,
    mistaken: 0,
  };
  // 未学習だけは学習履歴がないので、出題対象レベルのDBから数える
  for (const level of levels) {
    for (const w of dbs[level].words) {
      if (progressOf(progress[w.word], masterKnownCount) === "new") stats.new++;
    }
  }
  // 残りは学習履歴のある全単語 (レベル横断) で数える
  const index = buildIndex(dbs);
  for (const entry of Object.values(progress)) {
    if (!index.has(entry.word)) continue;
    const p = progressOf(entry, masterKnownCount);
    if (p !== "new") stats[p]++;
    const r = lastResult(entry);
    if (r) stats[r]++;
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
  masterKnownCount: number,
  asOf: Date,
): QueueStats {
  const pastProgress: Record<string, VocabEntry> = {};
  for (const [word, entry] of Object.entries(progress)) {
    const p = entryAsOf(entry, asOf);
    if (p) pastProgress[word] = p;
  }
  return dbStats(dbs, levels, pastProgress, masterKnownCount);
}

// 演習モードの新出比率。設定値が壊れていても出題が止まらないようにここで丸める
export function drillNewRatio(settings: VocabSettings): number {
  const r = settings.drillNewRatio;
  if (typeof r !== "number" || !Number.isFinite(r)) return 50;
  return Math.max(0, Math.min(100, r));
}

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
  const master = settings.masterKnownCount;

  // 学習履歴のある単語 (全レベル横断) を学習進捗度で仕分ける
  const inProgress: { item: WordDbEntry; w: number }[] = []; // 学習中 (復習の対象)
  const learned: { item: WordDbEntry; w: number }[] = []; // 学習完了
  for (const entry of Object.values(progress)) {
    const info = index.get(entry.word);
    if (!info || exclude.has(info.def.word)) continue;
    const pick = { item: info.def, w: reviewWeight(entry) };
    const p = progressOf(entry, master);
    if (p === "learning") inProgress.push(pick);
    else if (p === "done") learned.push(pick);
    // 手で「未学習」に戻した語は既出ではないので、下の新出側で拾わせる
  }

  // 復習: 学習中のものだけ。reviewWeight() が × の多い語を優先して引く
  if (mode === "review") return weightedSample(inProgress, size);

  // 演習: 出題対象レベルの未学習を「新出」、履歴のある語を「既出」として比率で混ぜる
  const fresh: { item: WordDbEntry; w: number }[] = [];
  for (const level of levels) {
    for (const w of dbs[level].words) {
      if (exclude.has(w.word)) continue;
      if (progressOf(progress[w.word], master) === "new") {
        fresh.push({ item: w, w: 1 });
      }
    }
  }
  const seen = [...inProgress, ...learned];

  const freshCount = Math.round((size * drillNewRatio(settings)) / 100);
  const queue = weightedSample(fresh, freshCount);
  queue.push(...weightedSample(seen, size - queue.length));

  // 片方の在庫が尽きたらもう片方で埋める。比率はあくまで目安で、
  // 出題が止まるくらいなら比率を崩す
  if (queue.length < size) {
    const used = new Set(queue.map((q) => q.word));
    const fill = [...fresh, ...seen].filter((p) => !used.has(p.item.word));
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
