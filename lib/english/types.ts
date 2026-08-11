// 英語学習アプリの型定義

export type Level = "A1" | "A2" | "B1" | "B2" | "C1";

export const LEVELS: {
  key: Level;
  label: string;
  guide: string;
  passageWords: string;
}[] = [
  { key: "A1", label: "初級", guide: "英検3級 / TOEIC 〜350", passageWords: "80〜120語" },
  { key: "A2", label: "初中級", guide: "英検準2級 / TOEIC 350〜500", passageWords: "120〜160語" },
  { key: "B1", label: "中級", guide: "英検2級 / TOEIC 500〜700", passageWords: "160〜220語" },
  { key: "B2", label: "中上級", guide: "英検準1級 / TOEIC 700〜850", passageWords: "220〜300語" },
  { key: "C1", label: "上級", guide: "英検1級 / TOEIC 850〜", passageWords: "280〜380語" },
];

export const INTEREST_PRESETS = [
  "テクノロジー",
  "ビジネス・経済",
  "スポーツ",
  "映画・ドラマ",
  "恋愛",
  "音楽",
  "旅行",
  "科学",
  "ゲーム",
  "料理",
  "歴史",
];

export const GRAMMAR_TOPICS = [
  "時制",
  "助動詞",
  "受動態",
  "不定詞・動名詞",
  "分詞",
  "関係詞",
  "比較",
  "仮定法",
  "前置詞",
  "接続詞",
  "冠詞・名詞",
  "語法・熟語",
];

// ---- 単語データベース (public/english-words/{level}.json。事前生成) ----

export interface WordDbEntry {
  word: string;
  pos: string;
  meaningJa: string;
  distractors: string[]; // 4択の誤答3つ
  exampleEn: string;
  exampleJa: string;
}

export interface WordDb {
  level: Level;
  generatedAt: string;
  count: number;
  words: WordDbEntry[];
}

// ---- 学習進捗 (生徒個人のデータベース。localStorageに保存) ----

// カードへの回答の種類
export type VocabAction =
  | "known" // 知っている
  | "unsure_correct" // 怪しい → 4択で正解
  | "unsure_wrong" // 怪しい → 4択で誤答
  | "unknown"; // 知らない

// DBの単語1語に紐づく学習記録
export interface VocabEntry {
  word: string;
  level: Level;
  meaningJa: string;
  knownCount: number; // 「知っている」と答えた回数
  unsureCount: number; // 「怪しい」と答えた回数
  unknownCount: number; // 「知らない」と答えた回数
  correctCount: number; // 4択の正解回数
  wrongCount: number; // 4択の誤答回数
  needsReview: boolean; // 直近が誤答/知らない (長文読解の題材になる)
  lastCorrectAt: string | null; // 最終正解日時 (知っている or 4択正解)
  lastSeenAt: string;
  history: { t: string; r: VocabAction }[]; // 回答履歴 (日時つき、直近50件)
}

export interface VocabSettings {
  masterKnownCount: number; // この回数以上「知っている」→ 出題から除外
  reviewIntervalDays: number; // 最終正解からこの日数が経過したら再出現
}

// 単語レベルの状態。current が null の間は初回測定 (10問) を行う。
// recent は直近の正誤 (最大20件) で、正解率に応じてレベルを自動調整する
export interface VocabLevelState {
  current: Level | null;
  recent: boolean[];
}

export const DEFAULT_VOCAB_SETTINGS: VocabSettings = {
  masterKnownCount: 3,
  reviewIntervalDays: 30,
};

export interface GrammarRecord {
  correct: number;
  wrong: number;
}

// ---- 文法問題データベース (public/english-grammar/{level}.json。事前生成) ----

export interface GrammarDbItem {
  id: string;
  topic: string;
  question: string;
  choices: string[];
  answerIndex: number;
  explanationJa: string;
}

export interface GrammarDb {
  level: Level;
  generatedAt: string;
  count: number;
  items: GrammarDbItem[];
}

export interface ReadingQuestion {
  question: string;
  choices: string[];
  answerIndex: number;
  explanationJa: string;
}

export interface SavedReading {
  id: string;
  createdAt: string;
  title: string;
  passageEn: string;
  translationJa: string;
  glossary: { word: string; meaningJa: string }[];
  questions: ReadingQuestion[];
  score: { correct: number; total: number } | null;
}

export interface EnglishData {
  settings: {
    level: Level | null;
    interests: string[];
    vocab: VocabSettings;
  };
  vocab: Record<string, VocabEntry>;
  vocabLevel: VocabLevelState;
  grammar: Record<string, GrammarRecord>;
  grammarSeen: string[]; // 出題済み問題id (直近300件。未出題を優先するため)
  readings: SavedReading[];
  stats: {
    vocabAnswered: number;
    vocabCorrect: number;
    grammarAnswered: number;
    grammarCorrect: number;
  };
}

export const EMPTY_DATA: EnglishData = {
  settings: { level: null, interests: [], vocab: DEFAULT_VOCAB_SETTINGS },
  vocab: {},
  vocabLevel: { current: null, recent: [] },
  grammar: {},
  grammarSeen: [],
  readings: [],
  stats: { vocabAnswered: 0, vocabCorrect: 0, grammarAnswered: 0, grammarCorrect: 0 },
};

// ---- APIレスポンスの型 (route.ts と共有) ----

export interface ReadingResult {
  title: string;
  passageEn: string;
  translationJa: string;
  glossary: { word: string; meaningJa: string }[];
  questions: ReadingQuestion[];
}
