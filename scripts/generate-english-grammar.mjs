// レベル別英文法問題データベースの一括生成スクリプト
// 使い方: node scripts/generate-english-grammar.mjs
// 出力: public/english-grammar/{A1..C1}.json
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY が .env.local にありません");
  process.exit(1);
}

const client = new Anthropic();

const LEVELS = {
  A1: "CEFR A1 (初級。英検3級・TOEIC 350未満相当。中学英語の文法)",
  A2: "CEFR A2 (初中級。英検準2級・TOEIC 350〜500相当。高校基礎の文法)",
  B1: "CEFR B1 (中級。英検2級・TOEIC 500〜700相当。高校修了〜大学入試の文法)",
  B2: "CEFR B2 (中上級。英検準1級・TOEIC 700〜850相当。ビジネス・大学中級の文法運用)",
  C1: "CEFR C1 (上級。英検1級・TOEIC 850以上相当。微妙なニュアンスの使い分け)",
};

// 12トピックを3グループに分けて生成する (1コール = 4トピック × 10問)
const TOPIC_GROUPS = [
  ["時制", "助動詞", "受動態", "不定詞・動名詞"],
  ["分詞", "関係詞", "比較", "仮定法"],
  ["前置詞", "接続詞", "冠詞・名詞", "語法・熟語"],
];
const QUESTIONS_PER_TOPIC = 10;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          question: { type: "string" },
          choices: { type: "array", items: { type: "string" } },
          answerIndex: { type: "integer" },
          explanationJa: { type: "string" },
        },
        required: ["topic", "question", "choices", "answerIndex", "explanationJa"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const SYSTEM = `あなたは英文法学習アプリの問題データベースを作る教材編集者である。指定レベル・指定トピックの英文法4択問題を生成する。

ルール:
- question は空所(____)を1つ含む英文。そのレベルの学習者が読める語彙で書く
- choices は4つ。空所に入る選択肢で、文法知識がないと選べない紛らわしいものにする(語彙問題にしない)
- answerIndex は正解の choices 内の位置(0始まり)。正解の位置は問題ごとにランダムにばらす
- explanationJa は日本語の解説。正解の文法ルールを簡潔に説明し、誤答がなぜ違うかにも一言触れる。最後に問題文全体の和訳を添える
- topic は指定されたトピック名をそのまま使う
- 難易度はレベルに厳密に合わせる。トピックがそのレベルに対して高度すぎる場合は、そのレベルで学ぶ基礎的な側面に絞る(例: A1の仮定法なら if を使った単純な条件文)
- 同じ論点・同じ英文の使い回しをしない。場面設定 (日常/学校/仕事/旅行など) も多様にする`;

async function generateBatch(levelKey, topics, attempt = 1) {
  try {
    const response = await client.messages
      .stream({
        model: "claude-opus-5",
        max_tokens: 30000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `レベル: ${LEVELS[levelKey]}

対象トピック: ${topics.join(" / ")}

各トピックにつき${QUESTIONS_PER_TOPIC}問、合計${topics.length * QUESTIONS_PER_TOPIC}問を生成せよ。`,
          },
        ],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      })
      .finalMessage();
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const items = JSON.parse(text).items.filter(
      (it) =>
        it.question &&
        Array.isArray(it.choices) &&
        it.choices.length === 4 &&
        it.answerIndex >= 0 &&
        it.answerIndex < 4 &&
        topics.includes(it.topic),
    );
    console.log(`  [${levelKey}] ${topics[0]}ほか: ${items.length}問`);
    return items;
  } catch (e) {
    if (attempt < 3) {
      console.warn(`  [${levelKey}] リトライ (${attempt}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return generateBatch(levelKey, topics, attempt + 1);
    }
    console.error(`  [${levelKey}] バッチ失敗: ${e.message}`);
    return [];
  }
}

async function main() {
  const limit = pLimit(4);
  const levelKeys = Object.keys(LEVELS);

  console.log(
    `${levelKeys.length}レベル × ${TOPIC_GROUPS.length}バッチ (${TOPIC_GROUPS.flat().length}トピック × ${QUESTIONS_PER_TOPIC}問) を生成します...`,
  );
  const t0 = Date.now();

  const results = await Promise.all(
    levelKeys.map(async (lv) => {
      const batches = await Promise.all(
        TOPIC_GROUPS.map((topics) => limit(() => generateBatch(lv, topics))),
      );
      return { level: lv, items: batches.flat() };
    }),
  );

  const outDir = path.join("public", "english-grammar");
  fs.mkdirSync(outDir, { recursive: true });

  for (const { level, items } of results) {
    // 同一レベル内の重複英文を除去し、idを振る
    const seen = new Set();
    const unique = [];
    for (const it of items) {
      const key = it.question.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ id: `${level}-${unique.length}`, ...it });
    }
    const out = {
      level,
      generatedAt: new Date().toISOString(),
      count: unique.length,
      items: unique,
    };
    fs.writeFileSync(path.join(outDir, `${level}.json`), JSON.stringify(out, null, 1));
    console.log(`${level}: ${unique.length}問 -> public/english-grammar/${level}.json`);
  }

  console.log(`完了 (${Math.round((Date.now() - t0) / 1000)}秒)`);
}

main();
