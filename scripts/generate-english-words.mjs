// レベル別英単語データベースの一括生成スクリプト
// 使い方: node scripts/generate-english-words.mjs
// 出力: public/english-words/{A1..C1}.json
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import pLimit from "p-limit";

// .env.local を読む (Nextの外なので手動ロード)
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
  A1: "CEFR A1 (初級。英検3級・TOEIC 350未満相当。中学英語で習う基本語彙。ただし have/go/big のような誰でも知る超基礎語は除き、初級学習者が「覚えるべき」語を選ぶ)",
  A2: "CEFR A2 (初中級。英検準2級・TOEIC 350〜500相当。高校基礎レベルの語彙)",
  B1: "CEFR B1 (中級。英検2級・TOEIC 500〜700相当。高校修了〜大学入試レベルの語彙)",
  B2: "CEFR B2 (中上級。英検準1級・TOEIC 700〜850相当。大学中級・ビジネスで使う語彙)",
  C1: "CEFR C1 (上級。英検1級・TOEIC 850以上相当。新聞・学術文章の語彙)",
};

// 同一レベル内の重複を減らすため、テーマで3分割して生成する
const THEMES = [
  "日常生活・家庭・感情・人間関係・身体・食",
  "仕事・学校・社会・経済・お金・政治・法",
  "自然・科学・技術・健康・移動・文化・その他",
];

const WORDS_PER_BATCH = 110;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          pos: { type: "string" },
          meaningJa: { type: "string" },
          distractors: { type: "array", items: { type: "string" } },
          exampleEn: { type: "string" },
          exampleJa: { type: "string" },
        },
        required: ["word", "pos", "meaningJa", "distractors", "exampleEn", "exampleJa"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const SYSTEM = `あなたは英単語学習アプリの単語データベースを作る教材編集者である。指定レベル・指定テーマの英単語リストを生成する。

ルール:
- そのレベルの学習者が「これから覚えるべき」代表的な単語を選ぶ。レベルより易しすぎる語・難しすぎる語は入れない
- word は原形 (動詞は原形、名詞は単数形)。熟語・句動詞も少数(1割程度)含めてよい
- pos は品詞を日本語で (名詞/動詞/形容詞/副詞/前置詞/接続詞/熟語)
- meaningJa は最も代表的な日本語の意味 (簡潔に)
- distractors は4択クイズの誤答選択肢3つ。同じ品詞の別の英単語の意味で、紛らわしいものにする。meaningJa と意味が重なるものは不可
- exampleEn はそのレベルで読める短い例文。exampleJa はその和訳
- 同じ単語を重複させない`;

async function generateBatch(levelKey, theme, attempt = 1) {
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
テーマ領域: ${theme}

このレベル・テーマ領域の英単語を${WORDS_PER_BATCH}語生成せよ。テーマ領域はゆるい目安であり、そのレベルで重要な語を優先してよい。`,
          },
        ],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      })
      .finalMessage();
    if (response.stop_reason === "refusal") throw new Error("refusal");
    const text = response.content.find((b) => b.type === "text")?.text ?? "";
    const items = JSON.parse(text).items.filter(
      (it) => it.word && it.meaningJa && Array.isArray(it.distractors) && it.distractors.length === 3,
    );
    console.log(`  [${levelKey}] ${theme.slice(0, 8)}...: ${items.length}語`);
    return items;
  } catch (e) {
    if (attempt < 3) {
      console.warn(`  [${levelKey}] リトライ (${attempt}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return generateBatch(levelKey, theme, attempt + 1);
    }
    console.error(`  [${levelKey}] バッチ失敗: ${e.message}`);
    return [];
  }
}

async function main() {
  const limit = pLimit(4);
  const levelKeys = Object.keys(LEVELS);

  console.log(`${levelKeys.length}レベル × ${THEMES.length}バッチ × ${WORDS_PER_BATCH}語を生成します...`);
  const t0 = Date.now();

  // 全バッチを並列生成 (レベルごとにまとめる)
  const results = await Promise.all(
    levelKeys.map(async (lv) => {
      const batches = await Promise.all(
        THEMES.map((theme) => limit(() => generateBatch(lv, theme))),
      );
      return { level: lv, items: batches.flat() };
    }),
  );

  // レベル間・レベル内の重複除去 (低いレベルを優先)
  const seen = new Set();
  const outDir = path.join("public", "english-words");
  fs.mkdirSync(outDir, { recursive: true });

  for (const { level, items } of results) {
    const words = [];
    for (const it of items) {
      const key = it.word.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push({ ...it, word: it.word.trim() });
    }
    const out = { level, generatedAt: new Date().toISOString(), count: words.length, words };
    fs.writeFileSync(path.join(outDir, `${level}.json`), JSON.stringify(out, null, 1));
    console.log(`${level}: ${words.length}語 -> public/english-words/${level}.json`);
  }

  console.log(`完了 (${Math.round((Date.now() - t0) / 1000)}秒)`);
}

main();
