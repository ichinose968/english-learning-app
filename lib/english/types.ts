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

// 長文生成の勉強目的。文体・題材・設問形式が変わる
export const READING_PURPOSES: { key: string; label: string; desc: string }[] = [
  { key: "general", label: "一般", desc: "興味テーマ中心の読み物" },
  { key: "toeic", label: "TOEIC対策", desc: "ビジネス文書・メール・告知 (Part 7風)" },
  { key: "toefl", label: "TOEFL対策", desc: "アカデミックな講義・教科書調の説明文" },
  { key: "eiken", label: "英検対策", desc: "説明文・意見文 (長文問題風)" },
  { key: "business", label: "ビジネス英語", desc: "会議・交渉・メールなど実務場面" },
  { key: "news", label: "ニュース英語", desc: "新聞・ニュース記事の文体" },
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

// タグの固定語彙 (生成スクリプトと共通。表記を揃えてフィルタに使う)
export const WORD_DOMAINS = [
  "Business", "Academic", "DailyLife", "Travel", "Medical", "Legal",
  "Technical", "News", "Literary", "Casual",
] as const;
export const WORD_THEMES = [
  "Technology", "Finance", "Sports", "Environment", "Health", "Politics",
  "Education", "Food", "Art", "Science", "Society", "Work", "Family",
  "Nature", "History", "Law", "Psychology", "Entertainment",
] as const;
export const WORD_EXAMS = [
  "TOEIC", "TOEFL", "英検", "IELTS", "高校受験", "共通テスト", "難関大入試",
] as const;

// 分野・テーマの日本語表示
export const DOMAIN_LABEL_JA: Record<string, string> = {
  Business: "ビジネス", Academic: "学術", DailyLife: "日常", Travel: "旅行",
  Medical: "医療", Legal: "法務", Technical: "技術", News: "報道",
  Literary: "文語", Casual: "口語",
};
export const THEME_LABEL_JA: Record<string, string> = {
  Technology: "テクノロジー", Finance: "金融", Sports: "スポーツ",
  Environment: "環境", Health: "健康", Politics: "政治", Education: "教育",
  Food: "食", Art: "芸術", Science: "科学", Society: "社会", Work: "仕事",
  Family: "家族", Nature: "自然", History: "歴史", Law: "法律",
  Psychology: "心理", Entertainment: "娯楽",
};

export interface WordDbEntry {
  word: string;
  pos: string;
  meaningJa: string;
  distractors: string[]; // 4択の誤答3つ
  exampleEn: string;
  exampleJa: string;
  // ---- カード詳細用の付加情報 (scripts/enrich-english-words.mjs で付与) ----
  ipa?: string; // 発音記号
  posEn?: string; // 品詞 (英語表記)
  domains?: string[]; // 分野タグ (使う場面)
  themes?: string[]; // テーマタグ (話題)
  exams?: string[]; // 試験頻出タグ
  related?: { word: string; meaningJa: string }[]; // 派生語・関連語
  // ---- ユーザーが後から足した情報 ----
  // カードの背景画像 (data URL)。カード詳細からアップロードする
  bgImage?: string;
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
  lastSeenAt: string;
  history: { t: string; r: VocabAction }[]; // 回答履歴 (日時つき、直近50件)
  resultOverride?: LastResult; // カード詳細で手動指定した前回結果
  progressOverride?: Progress; // カード詳細で手動指定した学習進捗度
}

// 単語の状態は2軸で持つ。1つに混ぜると「なぜこの語が出るのか」が読めなくなるため分ける。
//
// 1. 前回結果 (LastResult): 最後にユーザーが答えた結果そのもの。○ を付ければ ○、
//    あとで × を付ければ × に変わる。未回答なら null。
// 2. 学習進捗度 (Progress): その語を身につけたかどうか。出題の対象はこちらで決める。
export type LastResult =
  | "known" // ○
  | "fuzzy" // △ (4択の正誤は問わない)
  | "unknown"; // ×

export type Progress =
  | "new" // 未学習。まだ一度も出題していない
  | "learning" // 学習中
  | "done"; // 学習完了。初回で正解した語、または ○ が masterKnownCount 回続いた語

// カード詳細から手で付け替えられる選択肢。どちらの軸も指定でき、
// 次にそのカードへ回答した時点で両方とも外れる
// (記録と食い違ったまま固定されると、タブの件数や出題対象がずれるため)
export const RESULT_OPTIONS: { key: LastResult; label: string }[] = [
  { key: "known", label: "○" },
  { key: "fuzzy", label: "△" },
  { key: "unknown", label: "×" },
];

export const PROGRESS_OPTIONS: { key: Progress; label: string }[] = [
  { key: "new", label: "未学習" },
  { key: "learning", label: "学習中" },
  { key: "done", label: "学習完了" },
];

// 出題するカードの範囲 (語彙のみ / イディオムのみ / 両方)
export type CardSource = "words" | "idioms" | "both";

// スワイプ時 (カードの表面) に表示する項目
export type CardFieldKey =
  | "word"
  | "ipa"
  | "pos"
  | "meaning"
  | "tags"
  | "example"
  | "related"
  | "note";

export const CARD_FIELDS: { key: CardFieldKey; label: string }[] = [
  { key: "word", label: "英単語" },
  { key: "ipa", label: "発音記号" },
  { key: "pos", label: "品詞" },
  { key: "meaning", label: "意味" },
  { key: "tags", label: "タグ (試験・分野・テーマ)" },
  { key: "example", label: "例文" },
  { key: "related", label: "派生語・関連語" },
  { key: "note", label: "メモ" },
];

// 出題する単語の難易度 (レベル) の決め方。
// auto は最初の10問で測定して正答率で自動調整する。manual はユーザーが選んだレベルから出す
export type LevelMode = "auto" | "manual";

export interface VocabSettings {
  cardSource: CardSource;
  cardFields: Record<CardFieldKey, boolean>;
  levelMode: LevelMode;
  manualLevels: Level[]; // levelMode が manual のときの出題対象 (1つ以上)
  // この回数「連続で」○ が続いたら学習完了とみなす。△ や × を挟むと連続は切れる
  masterKnownCount: number;
  // 回答後にカード裏の解説を見ずに次のカードへ進むか。モードごとに持つ。
  // 演習は仕分けが目的なので既定でオン、復習は覚え直しが目的なので既定でオフ
  skipReveal: Record<QuizMode, boolean>;
  // 演習モードで新出 (未学習) の語を出す割合 (%)。残りは既出の語から出す
  drillNewRatio: number;
}

// カード画面の出題モード。上部タブと1対1で対応する
// - drill: 演習。高速に「知っている / 知らない」へ仕分ける
// - review: 復習。取りこぼした語を解説付きで覚え直す
export type QuizMode = "drill" | "review";

// 単語レベルの状態。current が null の間は初回測定 (10問) を行う。
// recent は直近の正誤 (最大20件) で、正解率に応じてレベルを自動調整する
export interface VocabLevelState {
  current: Level | null;
  recent: boolean[];
}

export const DEFAULT_CARD_FIELDS: Record<CardFieldKey, boolean> = {
  word: true,
  ipa: true,
  pos: true,
  meaning: false,
  tags: false,
  example: false,
  related: false,
  note: false,
};

export const DEFAULT_VOCAB_SETTINGS: VocabSettings = {
  cardSource: "words",
  cardFields: DEFAULT_CARD_FIELDS,
  levelMode: "auto",
  manualLevels: ["B1"],
  masterKnownCount: 3,
  skipReveal: { drill: true, review: false },
  drillNewRatio: 50,
};

// ---- 長文読解の設定 (読解タブの中で変える) ----

export type ReadingLength = "short" | "normal" | "long";

// words が null のときはレベルごとの既定 (LEVELS.passageWords) を使う
export const READING_LENGTHS: {
  key: ReadingLength;
  label: string;
  desc: string;
  words: string | null;
}[] = [
  { key: "short", label: "短め", desc: "100語前後。すきま時間に1本", words: "90〜130語" },
  { key: "normal", label: "ふつう", desc: "レベルに合わせた標準的な長さ", words: null },
  { key: "long", label: "長め", desc: "300〜400語。じっくり読む", words: "320〜420語" },
];

export interface ReadingSettings {
  topics: string[]; // 空ならおまかせ (興味テーマから選ぶ)
  levelMode: LevelMode; // auto は測定した単語レベルに追随する
  manualLevel: Level;
  length: ReadingLength;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  topics: [],
  levelMode: "auto",
  manualLevel: "B1",
  length: "normal",
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

// AIチャットの1発言。localStorage に直近50件だけ残す。
// correction は「メッセージ添削」= ユーザーの英語への添削で、AIの返信の直前に入る
export interface ChatMessage {
  role: "user" | "assistant" | "correction";
  text: string;
  t: string; // ISO日時
}

// AIが1回に話す量
export type ChatVolume = "short" | "normal" | "long";

export const CHAT_VOLUMES: { key: ChatVolume; label: string; desc: string }[] = [
  { key: "short", label: "短め", desc: "1〜2文。テンポよく往復する" },
  { key: "normal", label: "ふつう", desc: "2〜4文。標準的な会話" },
  { key: "long", label: "長め", desc: "5〜7文。まとまった量を読む" },
];

// 会話トピック。おまかせ (空文字) のときは設定した興味テーマから選ぶ
export const CHAT_TOPICS = [
  "日常・雑談",
  "旅行",
  "仕事・ビジネス",
  "学校・勉強",
  "テクノロジー",
  "映画・音楽",
  "スポーツ",
  "食べ物・料理",
  "ニュース・社会",
  "面接・自己紹介",
];

export interface ChatSettings {
  // AIが使う英語の難易度。auto は測定した単語レベルに追随する
  levelMode: LevelMode;
  manualLevel: Level;
  volume: ChatVolume;
  topic: string; // 空文字ならおまかせ
  // オンにすると、AIの返信の前にユーザーの英語への添削 (メッセージ添削) を出す
  correction: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  levelMode: "auto",
  manualLevel: "B1",
  volume: "normal",
  topic: "",
  correction: true,
};

// ユーザーがカード詳細で編集した内容 (DBの値を上書きする)
export interface WordEdit {
  meaningJa?: string;
  ipa?: string;
  exampleEn?: string;
  exampleJa?: string;
  domains?: string[];
  themes?: string[];
  exams?: string[];
  related?: { word: string; meaningJa: string }[];
  bgImage?: string; // 背景画像 (data URL)。空文字なら削除
}

// DBの定義に編集内容を重ねて表示用のエントリを作る
export function applyEdit(
  def: WordDbEntry,
  edit: WordEdit | undefined,
): WordDbEntry {
  if (!edit) return def;
  const patch = Object.fromEntries(
    Object.entries(edit).filter(([, v]) => v !== undefined),
  );
  return { ...def, ...patch };
}

export interface EnglishData {
  settings: {
    level: Level | null;
    interests: string[];
    purpose: string; // READING_PURPOSES のkey
    vocab: VocabSettings;
    // 文法の出題難易度 (複数可)。空なら level に従う
    grammarLevels: Level[];
    chat: ChatSettings;
    reading: ReadingSettings;
  };
  vocab: Record<string, VocabEntry>;
  vocabLevel: VocabLevelState;
  notes: Record<string, string>; // 単語ごとのメモ
  edits: Record<string, WordEdit>; // カード詳細で編集した内容
  grammar: Record<string, GrammarRecord>;
  grammarSeen: string[]; // 出題済み問題id (直近300件。未出題を優先するため)
  readings: SavedReading[];
  chat: ChatMessage[]; // AIチャットの履歴 (直近50件)
  stats: {
    vocabAnswered: number;
    vocabCorrect: number;
    grammarAnswered: number;
    grammarCorrect: number;
  };
}

export const EMPTY_DATA: EnglishData = {
  settings: {
    level: null,
    interests: [],
    purpose: "general",
    vocab: DEFAULT_VOCAB_SETTINGS,
    grammarLevels: [],
    chat: DEFAULT_CHAT_SETTINGS,
    reading: DEFAULT_READING_SETTINGS,
  },
  vocab: {},
  vocabLevel: { current: null, recent: [] },
  notes: {},
  edits: {},
  grammar: {},
  grammarSeen: [],
  readings: [],
  chat: [],
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
