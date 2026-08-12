import {
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_READING_SETTINGS,
  DEFAULT_VOCAB_SETTINGS,
  EnglishData,
  EMPTY_DATA,
  Level,
  VocabEntry,
} from "./types";

const STORAGE_KEY = "english-app-data-v1";

// 旧形式 (v1初期: correct/wrong/updatedAt) の単語記録を新形式に変換する
function migrateVocabEntry(raw: unknown, level: Level | null): VocabEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.word !== "string") return null;
  if (typeof r.knownCount === "number") {
    // 既に新形式
    return r as unknown as VocabEntry;
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

// 再出現までの日数。以前は必ず数値 (既定30日) だったが、
// 「設定しない」(null) を既定に変えたので、旧既定の30はそのまま null に寄せる
function migrateReviewInterval(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw === 30) return null;
  return Math.max(1, Math.min(365, Math.round(raw)));
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
          reviewIntervalDays: migrateReviewInterval(
            parsed.settings?.vocab?.reviewIntervalDays,
          ),
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
