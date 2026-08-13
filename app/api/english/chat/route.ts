import { NextRequest, NextResponse } from "next/server";
import {
  apiKeyErrorResponse,
  generateChatReply,
  generateJson,
  handleGenerateError,
  missingApiKey,
  LEVEL_PROMPT,
} from "@/lib/english/generate";
import { ChatVolume } from "@/lib/english/types";

export const maxDuration = 60;

// 直近のやり取りだけ送る (トークンとレイテンシを抑えるため)
const HISTORY_LIMIT = 20;

// 添削ありのときは、添削と返信を1回の呼び出しでまとめて作る
const SCHEMA = {
  type: "object",
  properties: {
    correction: { type: "string" },
    reply: { type: "string" },
  },
  required: ["correction", "reply"],
  additionalProperties: false,
} as const;

const VOLUME_PROMPT: Record<ChatVolume, string> = {
  short: "返信は1〜2文。テンポよく短く返す。",
  normal: "返信は2〜4文。",
  long: "返信は5〜7文。話題を掘り下げて、具体例や自分の考えも交えて話す。",
};

interface Body {
  level?: string;
  interests?: string[];
  topic?: string;
  volume?: ChatVolume;
  correction?: boolean;
  messages?: { role: "user" | "assistant"; text: string }[];
}

export async function POST(req: NextRequest) {
  if (missingApiKey()) return apiKeyErrorResponse();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエストが不正です。" }, { status: 400 });
  }

  const history = (body.messages ?? []).filter((m) => m.text.trim().length > 0);
  if (history.length === 0) {
    return NextResponse.json({ error: "メッセージが空です。" }, { status: 400 });
  }

  const levelLine = body.level
    ? LEVEL_PROMPT[body.level] ?? body.level
    : "CEFR B1 (中級)";
  const interests = (body.interests ?? []).join("、");
  const volume = VOLUME_PROMPT[body.volume ?? "normal"] ?? VOLUME_PROMPT.normal;

  const system = [
    "あなたは日本人の英語学習者と1対1で話す、気さくな英会話パートナーです。",
    `相手の英語力は ${levelLine} です。この水準で理解できる語彙と文構造を使ってください。`,
    body.topic
      ? `会話の話題は「${body.topic}」を軸にしてください。脱線しても、自然に戻します。`
      : interests
        ? `相手の興味: ${interests}。話題選びの参考にしてください。`
        : "",
    "",
    "返信のルール:",
    "- 本文は英語で書く。" + volume + "会話が続くように必ず質問を1つ添える。",
    // 添削ありのときは英訳の提示が添削側の仕事になるので、返信では繰り返させない
    body.correction
      ? "- 相手が日本語で書いてきたら、その内容に英語で自然に反応する。英訳は添削側で示すので、返信には含めない。"
      : "- 相手が日本語で書いてきたら、英語で言いたいことを英語で示しつつ、日本語で軽く補足する。",
    "- 説教くさくしない。相手の話に興味を持って反応する。",
    "- 箇条書きや見出しは使わず、話し言葉で書く。",
  ]
    .filter(Boolean)
    .join("\n");

  const messages = history.slice(-HISTORY_LIMIT).map((m) => ({
    role: m.role,
    content: m.text,
  }));
  // **APIは先頭が user でないと 400 になる。** 履歴を後ろから切ると先頭が
  // assistant になることがあり、そうなると送信が失敗する。失敗した回は
  // assistant の返信が増えないので長さの偶奇が変わらず、以後ずっと同じ形で
  // 切り出されて **AI会話タブが恒久的に壊れる**（会話をリセットするまで直らない）
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();

  try {
    // 添削なしなら素のテキストだけ返す
    if (!body.correction) {
      const reply = await generateChatReply({ system, messages });
      return NextResponse.json({ reply, correction: "" });
    }

    const result = await generateJson<{ correction: string; reply: string }>({
      system:
        system +
        [
          "",
          "この会話ではあなたは添削も担当します。次のJSONを返してください。",
          "- correction: 直前の相手の発言に対する日本語の添削。学習者が添削をオンにしているので毎回必ず書く。",
          "  発言の内容で次の3つに書き分ける。",
          "  (a) 英語に誤りや不自然な言い方があるとき:",
          "      直した英文を先に置き、続けて日本語で1〜2文の説明。複数あれば空行で区切る。",
          "  (b) 英語に直すところが無いとき:",
          "      「直すところはありません。」と書き、続けてもう一段自然な言い換えを英文で1つ添えて、",
          "      どう違うのかを日本語で1文書く。",
          "  (c) 相手が日本語で書いたとき:",
          "      その内容を英語で言うとどうなるかを英文で示し、続けて日本語で1〜2文の補足。",
          "  どの場合も、無い誤りをでっち上げて指摘しない。",
          "- reply: 上のルールどおりの英語の返信本文。添削の内容は返信には繰り返さない。",
        ].join("\n"),
      messages,
      schema: SCHEMA,
      maxTokens: 3000,
    });

    return NextResponse.json({
      reply: result.reply,
      correction: result.correction,
    });
  } catch (e) {
    return handleGenerateError(e, "chat");
  }
}
