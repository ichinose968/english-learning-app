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

const STORAGE_KEY = "english-app-data-v1";

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

export function loadData(): EnglishData {
  if (typeof window === "undefined") return EMPTY_DATA;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_DATA;
    const parsed = JSON.parse(raw) as Partial<EnglishData>;
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
  } catch {
    return EMPTY_DATA;
  }
}

export function saveData(data: EnglishData): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearData(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
