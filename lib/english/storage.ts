import {
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
    lastCorrectAt: correct > 0 && r.needsReview !== true ? updatedAt : null,
    lastSeenAt: updatedAt,
    history: [],
  };
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
        vocab: {
          ...DEFAULT_VOCAB_SETTINGS,
          ...(parsed.settings?.vocab ?? {}),
        },
      },
      vocab,
      vocabLevel: parsed.vocabLevel ?? { current: null, recent: [] },
      grammar: parsed.grammar ?? {},
      grammarSeen: parsed.grammarSeen ?? [],
      readings: parsed.readings ?? [],
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
