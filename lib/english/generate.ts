// サーバー専用: Claude APIで構造化JSONを生成する共通ヘルパー (app/api/english/* から使う)
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

const MODEL = "claude-opus-5";

export function missingApiKey(): boolean {
  return !process.env.ANTHROPIC_API_KEY;
}

export function apiKeyErrorResponse() {
  return NextResponse.json(
    {
      error:
        "ANTHROPIC_API_KEY が設定されていません。プロジェクト直下の .env.local に ANTHROPIC_API_KEY=sk-ant-... を追記して、開発サーバーを再起動してください。",
    },
    { status: 500 },
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

// 会話用。構造化せずにテキストをそのまま返す
export async function generateChatReply(args: {
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  maxTokens?: number;
}): Promise<string> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: args.maxTokens ?? 1024,
    system: args.system,
    messages: args.messages,
  });
  if (response.stop_reason === "refusal") {
    throw new GenerateRefusalError();
  }
  return response.content.find((b) => b.type === "text")?.text ?? "";
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
    return NextResponse.json(
      { error: "Anthropic APIの認証に失敗しました。.env.local の ANTHROPIC_API_KEY を確認してください。" },
      { status: 500 },
    );
  }
  // 残高切れは 400 で返ってくる。原因が分かる文言にしないと解決できない
  if (
    e instanceof Anthropic.BadRequestError &&
    /credit balance/i.test(String(e.message))
  ) {
    return NextResponse.json(
      {
        error:
          "Anthropic APIの残高が不足しています。console.anthropic.com の Plans & Billing でクレジットを追加してください。",
      },
      { status: 402 },
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
