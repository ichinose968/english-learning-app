// サーバー専用: Claude APIで構造化JSONを生成する共通ヘルパー (app/api/english/* から使う)
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const MODEL = "claude-opus-5";

export function missingApiKey(): boolean {
  return !process.env.ANTHROPIC_API_KEY;
}

// **運用側の事情は本番のユーザーに見せない。**
// 「.env.local に ANTHROPIC_API_KEY=sk-ant-... を追記して開発サーバーを再起動」
// 「console.anthropic.com の Plans & Billing でクレジットを追加」といった案内が、
// そのまま読解タブの赤字に出ていた。公開URLなので一般ユーザーにも、
// APIを叩いている相手にも読める。残高切れの文言に至っては
// 「枯らし切った」という合図まで返していた。
//
// 原因は console.error でサーバー側 (Vercel のログ) にだけ残す。
// 手元では今までどおり詳しく出ないと直せないので、開発時だけ元の文言を出す。
const DEV = process.env.NODE_ENV !== "production";

// 運用側の問題 (鍵が無い・鍵が無効・残高切れ) はユーザーには全部同じに見える。
// どれも「こちらの都合でいま使えない」であって、ユーザーに打てる手は無い
const UNAVAILABLE = "いま教材を生成できません。時間をおいてもう一度お試しください。";

function operatorError(status: number, label: string, devMessage: string, e?: unknown) {
  console.error(`[english/generate] ${label}`, e ?? "");
  return NextResponse.json(
    { error: DEV ? devMessage : UNAVAILABLE },
    { status },
  );
}

export function apiKeyErrorResponse() {
  return operatorError(
    500,
    "ANTHROPIC_API_KEY が未設定",
    "ANTHROPIC_API_KEY が設定されていません。プロジェクト直下の .env.local に ANTHROPIC_API_KEY=sk-ant-... を追記して、開発サーバーを再起動してください。",
  );
}

// 構造化出力 (output_config.format) でJSONを生成してパースする。
// 失敗時は throw し、呼び出し側で handleGenerateError に渡す。
export async function generateJson<T>(args: {
  system: string;
  // 単発の指示なら user、会話の続きなら messages を渡す (どちらか一方)
  user?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: args.maxTokens ?? 16000,
    system: args.system,
    messages: args.messages ?? [{ role: "user", content: args.user ?? "" }],
    output_config: {
      format: { type: "json_schema", schema: args.schema },
    },
  });

  if (response.stop_reason === "refusal") {
    throw new GenerateRefusalError();
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("output truncated (max_tokens)");
  }

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  return JSON.parse(text) as T;
}

// 会話用。構造化せずにテキストをそのまま返す。
//
// **claude-opus-5 は `thinking` を省略すると adaptive thinking が既定で走り、
// その思考トークンも `max_tokens` に含まれる。** 以前ここは 1024 だったので、
// 会話量「長め」や履歴が伸びたときに思考で使い切って、途中で切れた返信や
// 空文字が HTTP 200 のまま返っていた（`stop_reason` を見ていなかったので
// 気づけない）。上限を上げたうえで、短い雑談に見合うよう effort を下げる。
// `thinking: disabled` は選ばない。opus-5 で思考を切ると
// ツール呼び出しが本文に混ざる／`<thinking>` タグが漏れる既知の失敗があり、
// effort を下げるほうが安全で、費用もほぼ同じだけ下がる。
export async function generateChatReply(args: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: args.maxTokens ?? 4000,
    system: args.system,
    messages: args.messages,
    output_config: { effort: "low" },
  });
  if (response.stop_reason === "refusal") {
    throw new GenerateRefusalError();
  }
  // 切れた返信を成功として返さない（generateJson と同じ扱い）
  if (response.stop_reason === "max_tokens") {
    throw new Error("output truncated (max_tokens)");
  }
  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  if (!text.trim()) {
    throw new Error("empty reply");
  }
  return text;
}

export class GenerateRefusalError extends Error {
  constructor() {
    super("refusal");
  }
}

export function handleGenerateError(e: unknown, label: string) {
  if (e instanceof GenerateRefusalError) {
    return NextResponse.json(
      { error: "この内容には回答できませんでした。条件を変えてもう一度お試しください。" },
      { status: 502 },
    );
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return operatorError(
      500,
      `${label}: Anthropic の認証に失敗 (キーが無効か失効)`,
      "Anthropic APIの認証に失敗しました。.env.local の ANTHROPIC_API_KEY を確認してください。",
      e,
    );
  }
  // 残高切れは 400 で返ってくる。**ステータスは 402 のまま分けておく。**
  // 文言は本番では他と同じでも、ログとステータスで運用側が切り分けられる
  if (
    e instanceof Anthropic.BadRequestError &&
    /credit balance/i.test(String(e.message))
  ) {
    return operatorError(
      402,
      `${label}: Anthropic の残高不足`,
      "Anthropic APIの残高が不足しています。console.anthropic.com の Plans & Billing でクレジットを追加してください。",
      e,
    );
  }
  if (e instanceof Anthropic.RateLimitError) {
    return NextResponse.json(
      { error: "APIのレート制限に達しました。少し待ってから再試行してください。" },
      { status: 429 },
    );
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return NextResponse.json(
      { error: "ネットワークエラーが発生しました。接続を確認してください。" },
      { status: 502 },
    );
  }
  console.error(`${label} error:`, e);
  return NextResponse.json(
    { error: "教材の生成に失敗しました。もう一度お試しください。" },
    { status: 500 },
  );
}

// レベル表記をプロンプト用に展開する
export const LEVEL_PROMPT: Record<string, string> = {
  A1: "CEFR A1 (初級。英検3級・TOEIC 350未満相当。中学英語の基本語彙1000語程度)",
  A2: "CEFR A2 (初中級。英検準2級・TOEIC 350〜500相当。高校基礎レベルの語彙)",
  B1: "CEFR B1 (中級。英検2級・TOEIC 500〜700相当。高校修了〜大学入試レベルの語彙)",
  B2: "CEFR B2 (中上級。英検準1級・TOEIC 700〜850相当。大学中級・ビジネスで使う語彙)",
  C1: "CEFR C1 (上級。英検1級・TOEIC 850以上相当。新聞・学術文章の語彙)",
};
