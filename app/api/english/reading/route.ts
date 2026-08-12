import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyErrorResponse,
  generateJson,
  handleGenerateError,
  missingApiKey,
  LEVEL_PROMPT,
} from "@/lib/english/generate";
import { LEVELS, READING_LENGTHS, ReadingResult } from "@/lib/english/types";

export const maxDuration = 120;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    passageEn: { type: "string" },
    translationJa: { type: "string" },
    glossary: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          meaningJa: { type: "string" },
        },
        required: ["word", "meaningJa"],
        additionalProperties: false,
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answerIndex: { type: "integer" },
          explanationJa: { type: "string" },
        },
        required: ["question", "choices", "answerIndex", "explanationJa"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "passageEn", "translationJa", "glossary", "questions"],
  additionalProperties: false,
} as const;

// 勉強目的ごとの文体・題材・設問の指示
const PURPOSE_PROMPT: Record<string, string> = {
  general: "文体は自由。学習者の興味テーマを題材の中心にした、自然で面白い読み物にする。",
  toeic:
    "文体はTOEIC Part 7の読解文に寄せる。ビジネスメール、社内告知、広告、記事、報告書などの実務文書形式を1つ選んで書く(宛先や日付などの体裁も再現する)。設問は内容一致・詳細確認・書き手の意図を問う形式にする。興味テーマは題材に無理なく絡められる場合のみ使う。",
  toefl:
    "文体はTOEFLリーディングに寄せる。自然科学・社会科学・歴史などのアカデミックな説明文で、論理展開を明確にする。設問は要旨・推論・パラフレーズを問う形式にする。興味テーマに近い学術分野を選んでよい。",
  eiken:
    "文体は英検の長文問題に寄せる。段落構成の明確な説明文または意見文にする。設問は各段落の要旨と詳細を問う形式にする。",
  business:
    "ビジネスの実務場面(会議、交渉、メール、プレゼン、市場分析)を舞台にした文章にする。ビジネスで頻出する表現を自然に織り込む。",
  news: "新聞・ニュース記事の文体で書く(見出し的なタイトル、リード文、本文の構成)。時事的な話題を扱う(架空の出来事でよい)。",
};

const SYSTEM = `あなたは英語長文読解アプリの教材ジェネレーターである。学習者の勉強目的・興味・語彙レベルに合わせたオリジナルの英文と設問を生成する。

ルール:
- passageEn は指定レベルの語彙・文法で書いた自然で面白い英文。指定の語数に収める。学習者の興味テーマから1つ選ぶか自然に組み合わせる
- 「ターゲット単語」が与えられた場合、全てのターゲット単語を本文中で必ず1回以上、自然な文脈で使う。ターゲット単語が主役になるよう、それらが自然に登場する題材と筋書きを先に決めてから本文を書く。ターゲット単語の各出現箇所は **word** のように前後を ** で囲む(活用形で使った場合も囲む)。ターゲット単語以外は囲まない
- title は本文の内容を表す英語タイトル
- translationJa は本文全体の自然な和訳
- glossary にはターゲット単語全てに加え、そのレベルの学習者がつまずきそうな語句を3〜5個載せる(word は本文中の表記、meaningJa は文脈での意味)
- questions は本文の内容理解を問う4択問題を3問。question と choices は英語で書き、本文を読まないと解けない問題にする(常識だけで解ける問題は禁止)。answerIndex は正解の位置(0始まり)で、位置はランダムにする。explanationJa は日本語で根拠となる本文箇所を示す解説`;

export async function POST(req: NextRequest) {
  let body: {
    level: string;
    interests?: string[];
    purpose?: string;
    length?: string;
    targetWords?: { word: string; meaningJa: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (missingApiKey()) return apiKeyErrorResponse();

  const levelDesc = LEVEL_PROMPT[body.level];
  const levelDef = LEVELS.find((l) => l.key === body.level);
  if (!levelDesc || !levelDef) {
    return NextResponse.json({ error: "invalid level" }, { status: 400 });
  }

  const interests = (body.interests ?? []).slice(0, 10);
  // 長さの指定があればレベル既定の語数より優先する
  const lengthDef = READING_LENGTHS.find((l) => l.key === body.length);
  const passageWords = lengthDef?.words ?? levelDef.passageWords;
  const targets = (body.targetWords ?? []).slice(0, 8);

  const purposeInstruction =
    PURPOSE_PROMPT[body.purpose ?? "general"] ?? PURPOSE_PROMPT.general;

  const user = `レベル: ${levelDesc}
本文の語数: ${passageWords}

勉強目的に応じた文体・設問の指示: ${purposeInstruction}

学習者の興味テーマ: ${interests.length > 0 ? interests.join(" / ") : "(指定なし。一般的に面白いテーマでよい)"}

ターゲット単語(学習者がいま学習中・要復習の単語。全て本文に組み込み ** で囲む):
${
    targets.length > 0
      ? targets.map((t) => `- ${t.word} (${t.meaningJa})`).join("\n")
      : "(なし。ターゲットなしで本文を書く)"
  }

この条件で読解教材を1本生成せよ。`;

  try {
    const result = await generateJson<ReadingResult>({
      system: SYSTEM,
      user,
      schema: SCHEMA,
    });
    const questions = result.questions.filter(
      (q) =>
        q.choices.length === 4 &&
        q.answerIndex >= 0 &&
        q.answerIndex < q.choices.length,
    );
    if (!result.passageEn || questions.length === 0) {
      return NextResponse.json({ error: "生成結果が不正でした。もう一度お試しください。" }, { status: 500 });
    }
    return NextResponse.json({ ...result, questions });
  } catch (e) {
    return handleGenerateError(e, "english/reading");
  }
}
