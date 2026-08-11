import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyErrorResponse,
  generateJson,
  handleGenerateError,
  missingApiKey,
  LEVEL_PROMPT,
} from "@/lib/english/generate";
import { LEVELS, ReadingResult } from "@/lib/english/types";

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

const SYSTEM = `あなたは英語長文読解アプリの教材ジェネレーターである。学習者の興味と語彙レベルに合わせたオリジナルの英文と設問を生成する。

ルール:
- passageEn は指定レベルの語彙・文法で書いた自然で面白い英文。指定の語数に収める。学習者の興味テーマから1つ選ぶか自然に組み合わせる
- 「ターゲット単語」が与えられた場合、全てのターゲット単語を本文中で必ず1回以上、自然な文脈で使う。ターゲット単語の各出現箇所は **word** のように前後を ** で囲む(活用形で使った場合も囲む)。ターゲット単語以外は囲まない
- title は本文の内容を表す英語タイトル
- translationJa は本文全体の自然な和訳
- glossary にはターゲット単語全てに加え、そのレベルの学習者がつまずきそうな語句を3〜5個載せる(word は本文中の表記、meaningJa は文脈での意味)
- questions は本文の内容理解を問う4択問題を3問。question と choices は英語で書き、本文を読まないと解けない問題にする(常識だけで解ける問題は禁止)。answerIndex は正解の位置(0始まり)で、位置はランダムにする。explanationJa は日本語で根拠となる本文箇所を示す解説`;

export async function POST(req: NextRequest) {
  let body: {
    level: string;
    interests?: string[];
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
  const targets = (body.targetWords ?? []).slice(0, 8);

  const user = `レベル: ${levelDesc}
本文の語数: ${levelDef.passageWords}

学習者の興味テーマ: ${interests.length > 0 ? interests.join(" / ") : "(指定なし。一般的に面白いテーマでよい)"}

ターゲット単語(学習者が単語クイズで間違えた復習対象。全て本文に組み込み ** で囲む):
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
