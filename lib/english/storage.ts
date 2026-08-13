import {
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_READING_SETTINGS,
  DEFAULT_VOCAB_SETTINGS,
  EnglishData,
  EMPTY_DATA,
  LastResult,
  Level,
  Progress,
  QuizMode,
  VocabEntry,
} from "./types";
import { clampRate } from "./speech";

/*
 * 学習記録の保存。**IndexedDB が主で、localStorage は使わない。**
 *
 * 以前は localStorage に丸ごと JSON で入れていたが、カードの背景画像が
 * 1枚あたり最大1.2MB (`MAX_IMAGE_CHARS`) 入るのに対して localStorage の上限は
 * 約5MB しかない。しかも `setItem` を try/catch 無しで呼んでいたので、
 * **画像を4枚入れた時点で例外が投げっぱなしになり、以後の学習記録が
 * 一切保存されなくなる**（しかも画面には何も出ない）。取り返しがつかない
 * データなので、容量に余裕があり失敗を捕まえられる IndexedDB へ移した。
 *
 * 旧データは初回に読み込んで IndexedDB へ移し、localStorage 側は
 * `english-app-data-v1-backup` に**改名して残す**（消さない）。
 * 改名するのは、IndexedDB がブラウザに追い出されたときに古いスナップショットへ
 * 黙って巻き戻るのを防ぐため。手で戻したいときのために中身は取ってある。
 */

const LEGACY_KEY = "english-app-data-v1";
const LEGACY_BACKUP_KEY = "english-app-data-v1-backup";

const DB_NAME = "english-app";
const DB_VERSION = 1;
const STORE = "state";
const RECORD_KEY = "data";

// 書き込みをまとめる間隔。カードは連続でめくるので、1回ごとに
// 全体を書くと無駄が大きい。短くしてあるのは、まとめている最中に
// アプリを閉じられたぶんが失われるため（下の flush も参照）
const SAVE_DEBOUNCE_MS = 400;

export type StorageProblem = "quota" | "conflict" | "failed";

let problemHandler: ((p: StorageProblem) => void) | null = null;

/** 保存に失敗したことを画面に出すためのハンドラ。EnglishApp が1つだけ登録する。 */
export function onStorageProblem(cb: ((p: StorageProblem) => void) | null): void {
  problemHandler = cb;
}

function reportProblem(p: StorageProblem) {
  problemHandler?.(p);
}

// --- IndexedDB の口 ---------------------------------------------------------

interface StoredRecord {
  // 書き込みのたびに1つ増える。別のタブが先に書いていないかの判定に使う
  rev: number;
  data: EnglishData;
}

let dbPromise: Promise<IDBDatabase> | null = null;
// IndexedDB が使えない環境 (プライベートモードなど) では localStorage へ退避する。
// 容量の問題は残るが、何も保存できないよりよい
let fallback = false;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("no indexedDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    // Safari はまれに開いたまま返ってこない。待ち続けるとアプリが起動しないので諦める
    req.onblocked = () => reject(new Error("indexedDB blocked"));
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

function readRecord(): Promise<StoredRecord | null> {
  return openDb().then(
    (db) =>
      new Promise<StoredRecord | null>((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(RECORD_KEY);
        req.onsuccess = () => resolve((req.result as StoredRecord) ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
}

// このタブが最後に読み書きした版。別のタブが割り込んで書いたかどうかを
// これで見る (null は「まだ何も読んでいない」)
let knownRev: number | null = null;
// 別タブに追い越されたら、以後このタブからは一切書かない。
// 書くと相手の記録を巻き戻してしまう
let conflicted = false;

/**
 * 1つのトランザクションの中で「今の版を読む → 自分の知っている版と同じなら書く」を行う。
 *
 * **別のタブ（ホーム画面のPWAとSafariのタブ、など）が同時に開いていると、
 * どちらも全体のコピーを持っているので、後から保存したほうが相手の記録を丸ごと
 * 上書きしてしまう。** 版番号が食い違ったら書かずに諦めて、画面に知らせる。
 * 黙って消えるよりは、再読み込みを促すほうがよい。
 */
function writeRecord(data: EnglishData): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        const get = store.get(RECORD_KEY);
        let nextRev = 1;
        let stale = false;
        get.onsuccess = () => {
          const cur = (get.result as StoredRecord) ?? null;
          if (cur && knownRev !== null && cur.rev !== knownRev) {
            stale = true;
            tx.abort();
            return;
          }
          nextRev = (cur?.rev ?? 0) + 1;
          store.put({ rev: nextRev, data } satisfies StoredRecord, RECORD_KEY);
        };
        tx.oncomplete = () => {
          knownRev = nextRev;
          resolve();
        };
        tx.onabort = () => {
          if (stale) {
            conflicted = true;
            reportProblem("conflict");
            resolve();
            return;
          }
          reject(tx.error ?? new Error("aborted"));
        };
        tx.onerror = () => reject(tx.error);
      }),
  );
}

// --- localStorage 側 (旧データの読み出しと、IndexedDB が使えないときの退避) ---

/*
 * **読むのは LEGACY_KEY だけ。`-backup` は自動では絶対に読まない。**
 *
 * `-backup` は移行時に凍結した「移行前のスナップショット」で、手で復元するための
 * 保管庫でしかない。ここで読んでしまうと、IndexedDB が空になったとき
 * （ブラウザの退去、DB名やバージョンの変更、「サイトデータを削除」）に
 * **移行日の記録へ黙って巻き戻り、それ以降の学習記録が全部消えたまま
 * 「昔のデータはある」状態になって事故に気づけない**。改名して残す意味が無くなる。
 */
function readLegacy(): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/*
 * IndexedDB が使えないときの退避先。**版番号を付けて書く。**
 *
 * 読みは「IndexedDB → 空なら localStorage」なのに、書きは
 * 「IndexedDB → 失敗したら localStorage」に落ちる。番号を付けずに書くと、
 * 途中で1回書き込みに失敗したセッションのぶんが
 * **次の起動で一度も読まれないまま IndexedDB 側に上書きされて消える**
 * （読みの優先順位が、書き先が切り替わったことを知らないため）。
 * 版番号を持たせて、下の loadData で新しいほうを採る。
 */
interface FallbackRecord {
  rev: number;
  data: EnglishData;
}

function writeFallback(data: EnglishData): void {
  if (typeof window === "undefined") return;
  try {
    const rec: FallbackRecord = { rev: (knownRev ?? 0) + 1, data };
    window.localStorage.setItem(LEGACY_KEY, JSON.stringify(rec));
    knownRev = rec.rev;
  } catch (e) {
    // 容量超過。ここを黙って握り潰していたのが元の不具合なので必ず知らせる
    const quota =
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED");
    reportProblem(quota ? "quota" : "failed");
  }
}

/**
 * localStorage 側に「IndexedDB より新しい退避」が残っていないかを見る。
 * 旧形式（版番号を持たない生の `EnglishData`）は移行前のデータなので rev 0 扱い。
 */
function readFallbackRecord(): FallbackRecord | null {
  const raw = readLegacy();
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.rev === "number" && r.data && typeof r.data === "object") {
    return { rev: r.rev, data: r.data as EnglishData };
  }
  return { rev: 0, data: raw as EnglishData };
}

// --- 旧形式のマイグレーション ------------------------------------------------

// 手動ステータスは1つだったが、前回結果 (○△×) と学習進捗度 (未学習/学習中/学習完了)
// の2軸に分けた。旧値は意味の近いほうの軸へ移し、対応しないものは指定ごと落とす。
// 落とさずに残すとバッジの定義を引けずに壊れる
const RESULT_VALUES = ["known", "fuzzy", "unknown"];
const PROGRESS_VALUES = ["new", "learning", "done"];

function migrateOverrides(r: Record<string, unknown>): {
  resultOverride?: LastResult;
  progressOverride?: Progress;
} {
  const out: { resultOverride?: LastResult; progressOverride?: Progress } = {};
  // 既に2軸を持っているデータはそのまま引き継ぐ
  if (typeof r.resultOverride === "string" && RESULT_VALUES.includes(r.resultOverride)) {
    out.resultOverride = r.resultOverride as LastResult;
  }
  if (
    typeof r.progressOverride === "string" &&
    PROGRESS_VALUES.includes(r.progressOverride)
  ) {
    out.progressOverride = r.progressOverride as Progress;
  }
  if (out.resultOverride || out.progressOverride) return out;

  // 1軸だった頃の値を振り分ける
  const old = r.statusOverride;
  if (typeof old !== "string") return out;
  if (RESULT_VALUES.includes(old)) out.resultOverride = old as LastResult;
  else if (old === "mastered") out.progressOverride = "done";
  else if (old === "learning") out.progressOverride = "learning";
  else if (old === "new") out.progressOverride = "new";
  else if (old === "review") out.resultOverride = "unknown";
  return out;
}

// 旧形式 (v1初期: correct/wrong/updatedAt) の単語記録を新形式に変換する
function migrateVocabEntry(raw: unknown, level: Level | null): VocabEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.word !== "string") return null;
  if (typeof r.knownCount === "number") {
    // 既に新形式。手動ステータスだけ2軸に振り分け直す
    const entry = { ...r } as unknown as VocabEntry & {
      statusOverride?: unknown;
      interval?: unknown;
      dueAt?: unknown;
    };
    delete entry.statusOverride;
    delete entry.resultOverride;
    delete entry.progressOverride;
    // 撤回した復習間隔 (エビングハウス) の残骸。書き込まれた端末から掃除する
    delete entry.interval;
    delete entry.dueAt;
    return { ...entry, ...migrateOverrides(r) };
  }
  const wrong = typeof r.wrong === "number" ? r.wrong : 0;
  const correct = typeof r.correct === "number" ? r.correct : 0;
  const updatedAt =
    typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString();
  return {
    word: r.word,
    level: level ?? "B1",
    meaningJa: typeof r.meaningJa === "string" ? r.meaningJa : "",
    knownCount: 0,
    unsureCount: correct + wrong,
    unknownCount: 0,
    correctCount: correct,
    wrongCount: wrong,
    needsReview: r.needsReview === true,
    lastSeenAt: updatedAt,
    history: [],
  };
}

// 解説を飛ばす設定。旧形式は ○ / × ごとの skipRevealOnKnown / skipRevealOnUnknown
// だったが、演習 / 復習のモードごとに持つ形に変えた。
// 演習は仕分けが目的なので常にオンから始め、復習は旧設定で両方オンにしていた人だけ引き継ぐ
function migrateSkipReveal(raw: unknown): Record<QuizMode, boolean> {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cur = r.skipReveal as Record<string, unknown> | undefined;
  if (cur && typeof cur.drill === "boolean" && typeof cur.review === "boolean") {
    return { drill: cur.drill, review: cur.review };
  }
  return {
    drill: true,
    review: r.skipRevealOnKnown === true && r.skipRevealOnUnknown === true,
  };
}

// 学習完了とみなす連続○の回数。壊れた値は既定に寄せる
function migrateMasterCount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_VOCAB_SETTINGS.masterKnownCount;
  }
  return Math.max(1, Math.min(10, Math.round(raw)));
}

// 演習モードの新出比率 (%)。旧データには無いので既定の50に寄せる
function migrateDrillNewRatio(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_VOCAB_SETTINGS.drillNewRatio;
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

// 読み上げの速さ。旧データには無いので既定の1に寄せ、範囲外は丸める
function migrateSpeechRate(raw: unknown): number {
  return clampRate(typeof raw === "number" ? raw : undefined);
}

/**
 * 保存されていた値を今の形に整える。IndexedDB から読んだものにも、
 * 旧 localStorage から拾ったものにも同じものを通す。
 * IndexedDB は構造化複製で入れるので JSON.parse は要らないが、
 * **古い版が書いた形が入っている可能性は同じ**なので整形は省けない。
 */
function normalize(parsed: Partial<EnglishData> | null): EnglishData {
  if (!parsed) return EMPTY_DATA;
  const level = parsed.settings?.level ?? null;

  const vocab: Record<string, VocabEntry> = {};
  for (const [word, entry] of Object.entries(parsed.vocab ?? {})) {
    const migrated = migrateVocabEntry(entry, level);
    if (migrated) vocab[word] = migrated;
  }

  return {
    settings: {
      level,
      interests: parsed.settings?.interests ?? [],
      purpose: parsed.settings?.purpose ?? "general",
      grammarLevels: parsed.settings?.grammarLevels ?? [],
      chat: {
        ...DEFAULT_CHAT_SETTINGS,
        ...(parsed.settings?.chat ?? {}),
      },
      reading: {
        ...DEFAULT_READING_SETTINGS,
        ...(parsed.settings?.reading ?? {}),
      },
      vocab: {
        ...DEFAULT_VOCAB_SETTINGS,
        ...(parsed.settings?.vocab ?? {}),
        cardFields: {
          ...DEFAULT_VOCAB_SETTINGS.cardFields,
          ...(parsed.settings?.vocab?.cardFields ?? {}),
        },
        masterKnownCount: migrateMasterCount(
          parsed.settings?.vocab?.masterKnownCount,
        ),
        skipReveal: migrateSkipReveal(parsed.settings?.vocab),
        drillNewRatio: migrateDrillNewRatio(
          parsed.settings?.vocab?.drillNewRatio,
        ),
        autoSpeak: parsed.settings?.vocab?.autoSpeak === true,
        speechRate: migrateSpeechRate(parsed.settings?.vocab?.speechRate),
      },
    },
    vocab,
    vocabLevel: parsed.vocabLevel ?? { current: null, recent: [] },
    notes: parsed.notes ?? {},
    edits: parsed.edits ?? {},
    grammar: parsed.grammar ?? {},
    grammarSeen: parsed.grammarSeen ?? [],
    readings: parsed.readings ?? [],
    chat: parsed.chat ?? [],
    // 旧フロー (SetupPanel でレベルを選んで始める) を通ったユーザーと、
    // 学習記録が既にあるユーザーには、チュートリアルを出さない
    tutorialDone:
      parsed.tutorialDone === true ||
      parsed.settings?.level != null ||
      Object.keys(vocab).length > 0,
    stats: parsed.stats ?? EMPTY_DATA.stats,
  };
}

// --- 読み書き ----------------------------------------------------------------

export async function loadData(): Promise<EnglishData> {
  if (typeof window === "undefined") return EMPTY_DATA;

  const stranded = readFallbackRecord();

  try {
    const rec = await readRecord();
    if (rec) {
      // **前のセッションが IndexedDB への書き込みに失敗して localStorage へ
      // 退避していた場合、そちらのほうが新しい。** 番号を比べて新しいほうを採る。
      // これをしないと、退避したぶんは一度も読まれないまま次の保存で消える
      if (stranded && stranded.rev > rec.rev) {
        knownRev = rec.rev;
        return normalize(stranded.data as Partial<EnglishData>);
      }
      knownRev = rec.rev;
      return normalize(rec.data as Partial<EnglishData>);
    }
    // IndexedDB が空。旧 localStorage から引き継ぐ
    const data = normalize(
      (stranded?.data ?? null) as Partial<EnglishData> | null,
    );
    knownRev = 0;
    if (stranded) {
      await writeRecord(data);
      // 移行できたら旧キーは改名して凍結する。残したままだと、
      // IndexedDB がブラウザに追い出されたとき古い記録へ黙って巻き戻る。
      // 読むのは LEGACY_KEY だけなので、改名した時点で自動経路から外れる
      try {
        const raw = window.localStorage.getItem(LEGACY_KEY);
        if (raw !== null) {
          window.localStorage.setItem(LEGACY_BACKUP_KEY, raw);
          window.localStorage.removeItem(LEGACY_KEY);
        }
      } catch {
        // 改名できなくても移行自体は済んでいる
      }
    }
    return data;
  } catch {
    // IndexedDB が開けない環境。localStorage で動かす
    fallback = true;
    knownRev = stranded?.rev ?? 0;
    return normalize((stranded?.data ?? null) as Partial<EnglishData> | null);
  }
}

let pending: EnglishData | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> = Promise.resolve();

/** 保存を予約する。呼び出し側は待たない（連続でめくるため、まとめて書く）。 */
export function saveData(data: EnglishData): void {
  if (typeof window === "undefined") return;
  if (conflicted) return; // 別タブに追い越されている。上書きしない
  pending = data;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushData();
  }, SAVE_DEBOUNCE_MS);
}

/** 溜めてある保存を今すぐ書き切る。アプリを閉じるときに呼ぶ。 */
export function flushData(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  const data = pending;
  pending = null;
  if (!data || conflicted) return inFlight;
  if (fallback) {
    writeFallback(data);
    return inFlight;
  }
  // 直前の書き込みと重ならないよう直列にする。並行させると
  // 版番号の読み書きが交差して、片方が「別タブが書いた」と誤検知する
  inFlight = inFlight
    .catch(() => {})
    .then(() => writeRecord(data))
    .catch(() => {
      // IndexedDB 側が駄目になったら localStorage へ落とす。
      // 画像で溢れる可能性はあるが、そのときは writeFallback が知らせる
      fallback = true;
      writeFallback(data);
    });
  return inFlight;
}

export async function clearData(): Promise<void> {
  if (typeof window === "undefined") return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  conflicted = false;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    knownRev = 0;
  } catch {
    // 開けないときは下の localStorage の掃除だけで済ませる
  }
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // 消せなくても実害は無い (次回 IndexedDB 側が空でなければ読まれない)
  }
}

/*
 * --- 書き出し / 読み込み -----------------------------------------------------
 *
 * 学習記録の唯一のバックアップ手段。取り返しがつかないデータなのに、
 * これが無いと (1) 端末の紛失・機種変更、(2) ブラウザによる退去や
 * 「サイトデータを削除」、(3) Capacitor 版への移行（**別オリジンになるので
 * PWA 側の IndexedDB は1件も見えない**）のどれでも全部消える。
 * ストア申請 (7章A-4) の前提でもある。
 */

const EXPORT_VERSION = 1;

interface ExportFile {
  app: "english";
  version: number;
  exportedAt: string;
  data: EnglishData;
}

/** 学習記録を1つのJSON文字列にする。ファイル名は呼び出し側が付ける。 */
export function exportData(data: EnglishData): string {
  const payload: ExportFile = {
    app: "english",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(payload);
}

/**
 * 書き出したJSONを読み戻す。**必ず normalize を通す**ので、古い版が書き出した
 * ファイルでも今の形に整えられる。中身が違うファイルは例外にして、
 * 学習記録を壊さないようにする。
 */
export function parseImport(text: string): EnglishData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("ファイルの形式が違います (JSONとして読めません)。");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("ファイルの形式が違います。");
  }
  const p = parsed as Record<string, unknown>;
  // 書き出しファイル形式。app が違うものは弾く (他アプリのJSONを取り込ませない)
  if (p.app !== undefined && p.app !== "english") {
    throw new Error("このアプリの書き出しファイルではありません。");
  }
  const body = (p.data ?? p) as Partial<EnglishData>;
  if (typeof body !== "object" || body === null) {
    throw new Error("ファイルの形式が違います。");
  }
  return normalize(body);
}

/**
 * 読み込んだ記録で今の記録を置き換える。**版番号を進めてから書く**ので、
 * 別タブとの衝突検知に引っかかって取り込みが黙って失敗することはない。
 */
export async function replaceData(data: EnglishData): Promise<void> {
  if (typeof window === "undefined") return;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  pending = null;
  conflicted = false;
  if (fallback) {
    writeFallback(data);
    return;
  }
  try {
    // 今の版に合わせてから書く (取り込みは上書きが目的なので衝突扱いにしない)
    const cur = await readRecord();
    knownRev = cur?.rev ?? 0;
    await writeRecord(data);
  } catch {
    fallback = true;
    writeFallback(data);
  }
}

/**
 * ブラウザにこのオリジンのデータを追い出さないよう頼む。
 * 断られても動きは変わらないので、返り値は使わない。
 * ホーム画面に追加した端末では通ることが多い。
 */
export function requestPersistentStorage(): void {
  if (typeof navigator === "undefined") return;
  void navigator.storage?.persist?.().catch(() => {});
}

/*
 * まとめている最中にアプリを閉じられた分を書き切る。
 * iOS はアプリを背面に回した時点で pagehide も visibilitychange も来るが、
 * そこから始めた書き込みが必ず終わる保証は無い。だからまとめる間隔
 * (SAVE_DEBOUNCE_MS) は短くしてある。
 */
if (typeof window !== "undefined") {
  const flush = () => {
    void flushData();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
