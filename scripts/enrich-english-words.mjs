// 単語・イディオムDBに詳細情報 (発音記号/品詞/分野/テーマ/試験/派生語) を付与する
// 使い方: node scripts/enrich-english-words.mjs [words|idioms|all]
//
// 冪等かつ再開可能: 既に付与済み (ipa を持つ) のエントリはスキップする。
// レベルごとに書き戻すので、途中で止めても進捗は失われない。
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
const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const BATCH = 80;
const CONCURRENCY = 6;

// タグは固定語彙から選ばせる (後でフィルタ・ソートに使うため表記を揃える)
const DOMAINS = [
  "Business", "Academic", "DailyLife", "Travel", "Medical", "Legal",
  "Technical", "News", "Literary", "Casual",
];
const THEMES = [
  "Technology", "Finance", "Sports", "Environment", "Health", "Politics",
  "Education", "Food", "Art", "Science", "Society", "Work", "Family",
  "Nature", "History", "Law", "Psychology", "Entertainment",
];
const EXAMS = [
  "TOEIC", "TOEFL", "英検", "IELTS", "高校受験", "共通テスト", "難関大入試",
];
const POS_EN = [
  "Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction",
  "Pronoun", "Phrasal Verb", "Idiom", "Phrase",
];

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          ipa: { type: "string" },
          posEn: { type: "string" },
          domains: { type: "array", items: { type: "string" } },
          themes: { type: "array", items: { type: "string" } },
          exams: { type: "array", items: { type: "string" } },
          related: {
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
        },
        required: ["word", "ipa", "posEn", "domains", "themes", "exams", "related"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const SYSTEM = `あなたは英語学習アプリの辞書データを整備する編集者である。与えられた見出し語に、学習者向けの詳細情報を付与する。

各項目のルール:
- ipa: アメリカ英語のIPA発音記号。スラッシュで囲む (例: /nɪˈɡoʊʃiˌeɪt/)。句動詞・熟語は全体の発音を書く
- posEn: 品詞を次から1つだけ選ぶ: ${POS_EN.join(" / ")}
- domains: どんな場面で使うかを次から1〜3個選ぶ: ${DOMAINS.join(" / ")}
- themes: 何について話すときに使うかを次から1〜3個選ぶ: ${THEMES.join(" / ")}
- exams: 出やすい試験を次から選ぶ (0〜4個。特に頻出のものだけ。無理に埋めない): ${EXAMS.join(" / ")}
- related: 派生語・関連語を0〜5個。同語根の派生 (negotiate → negotiation, negotiator) を優先し、なければ類義語・対義語でよい。meaningJa は簡潔な日本語の意味。関連語がない語は空配列にする

重要:
- domains / themes / exams は必ず上のリストにある表記をそのまま使う。リストにない語を作らない
- 与えられた見出し語すべてについて、入力と同じ順序・同じ表記で items を返す`;

async function enrichBatch(words, attempt = 1) {
  try {
    const res = await client.messages
      .stream({
        model: "claude-opus-5",
        max_tokens: 30000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `次の${words.length}語に詳細情報を付与せよ。\n\n${words
              .map((w) => `- ${w.word} (${w.pos}: ${w.meaningJa})`)
              .join("\n")}`,
          },
        ],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      })
      .finalMessage();
    if (res.stop_reason === "refusal") throw new Error("refusal");
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    return JSON.parse(text).items ?? [];
  } catch (e) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      return enrichBatch(words, attempt + 1);
    }
    console.error(`  バッチ失敗 (${words[0]?.word}...): ${e.message}`);
    return [];
  }
}

// 固定語彙以外を落とし、表記を揃える
function sanitize(item) {
  const pick = (arr, allowed) =>
    [...new Set((arr ?? []).map((x) => String(x).trim()))].filter((x) =>
      allowed.includes(x),
    );
  return {
    ipa: typeof item.ipa === "string" ? item.ipa.trim() : "",
    posEn: POS_EN.includes(item.posEn) ? item.posEn : "",
    domains: pick(item.domains, DOMAINS),
    themes: pick(item.themes, THEMES),
    exams: pick(item.exams, EXAMS),
    related: (item.related ?? [])
      .filter((r) => r && typeof r.word === "string" && typeof r.meaningJa === "string")
      .slice(0, 5)
      .map((r) => ({ word: r.word.trim(), meaningJa: r.meaningJa.trim() })),
  };
}

async function enrichFile(dir, level) {
  const file = path.join("public", dir, `${level}.json`);
  if (!fs.existsSync(file)) return { total: 0, added: 0 };
  const db = JSON.parse(fs.readFileSync(file, "utf8"));
  const todo = db.words.filter((w) => !w.ipa);
  if (todo.length === 0) {
    console.log(`  [${dir}/${level}] 付与済み (${db.words.length}語)`);
    return { total: db.words.length, added: 0 };
  }

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  console.log(`  [${dir}/${level}] ${todo.length}語 / ${batches.length}バッチ`);

  const limit = pLimit(CONCURRENCY);
  const results = await Promise.all(batches.map((b) => limit(() => enrichBatch(b))));

  const byWord = new Map();
  for (const item of results.flat()) {
    if (item?.word) byWord.set(item.word.trim().toLowerCase(), item);
  }

  let added = 0;
  for (const w of db.words) {
    if (w.ipa) continue;
    const item = byWord.get(w.word.toLowerCase());
    if (!item) continue;
    Object.assign(w, sanitize(item));
    added++;
  }

  db.enrichedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(db, null, 1));
  console.log(`  [${dir}/${level}] +${added} / ${db.words.length}語 -> 保存`);
  return { total: db.words.length, added };
}

async function main() {
  const target = process.argv[2] ?? "all";
  const dirs =
    target === "words"
      ? ["english-words"]
      : target === "idioms"
        ? ["english-idioms"]
        : ["english-words", "english-idioms"];

  const t0 = Date.now();
  let total = 0;
  let added = 0;
  for (const dir of dirs) {
    console.log(`== ${dir} ==`);
    for (const level of LEVELS) {
      const r = await enrichFile(dir, level);
      total += r.total;
      added += r.added;
    }
  }
  console.log(`完了: ${added}語に付与 / 全${total}語 (${Math.round((Date.now() - t0) / 1000)}秒)`);
}

main();
