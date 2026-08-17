// 既存の単語DBに **指定した見出し語だけ** を足す。
//
//   node scripts/expand-english-words.mjs <targets.json> [--limit N] [--dry]
//
// targets.json は [{ "surface": "abundant", "kind": "word" | "idiom" }, ...]。
// **このファイルはリポジトリに置かない。** 実行時に渡す。
// 市販単語帳の収録語を照合して作った一覧をそのまま抱えると、
// 「どの語を選ぶか」という編集の産物を再配布することに近づくため。
// **持ち込むのは「その語が載っている」という事実だけで、意味・例文・発音記号・
// 関連語はここで新しく作る。** 出来上がるDBの中身はこのアプリの自前の内容になる。
//
// 冪等かつ再開可能: 既にDBにある見出し語は毎回スキップし、
// バッチごとに書き出すので途中で止めても続きから走らせられる。
//
// **DBを更新したら public/english-sw.js の DATA_VERSION を上げること。**
// 上げないと、導入済みの端末はキャッシュ優先で古いDBを持ち続ける。
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

const args = process.argv.slice(2);
const targetsPath = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry");
const LIMIT = Number(args[args.indexOf("--limit") + 1]) || Infinity;
if (!targetsPath) {
  console.error("使い方: node scripts/expand-english-words.mjs <targets.json> [--limit N] [--dry]");
  process.exit(1);
}

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const POS_EN = ["Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction", "Phrase"];
const DOMAINS = ["Business", "Academic", "DailyLife", "Travel", "Medical", "Legal",
  "Technical", "News", "Literary", "Casual"];
const THEMES = ["Technology", "Finance", "Sports", "Environment", "Health", "Politics",
  "Education", "Food", "Art", "Science", "Society", "Work", "Family",
  "Nature", "History", "Law", "Psychology", "Entertainment"];
const EXAMS = ["TOEIC", "TOEFL", "英検", "IELTS", "高校受験", "共通テスト", "難関大入試"];

// 1件あたりの出力が大きい (例文・関連語まで作る) ので、既存の生成より小さく刻む
const BATCH = 30;
const CONCURRENCY = 3;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          word: { type: "string" },
          level: { type: "string" },
          pos: { type: "string" },
          meaningJa: { type: "string" },
          distractors: { type: "array", items: { type: "string" } },
          exampleEn: { type: "string" },
          exampleJa: { type: "string" },
          ipa: { type: "string" },
          posEn: { type: "string" },
          domains: { type: "array", items: { type: "string" } },
          themes: { type: "array", items: { type: "string" } },
          exams: { type: "array", items: { type: "string" } },
          related: {
            type: "array",
            items: {
              type: "object",
              properties: { word: { type: "string" }, meaningJa: { type: "string" } },
              required: ["word", "meaningJa"],
              additionalProperties: false,
            },
          },
        },
        required: ["word", "level", "pos", "meaningJa", "distractors", "exampleEn",
          "exampleJa", "ipa", "posEn", "domains", "themes", "exams", "related"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const SYSTEM = `あなたは英単語学習アプリの単語データベースを作る教材編集者である。**与えられた見出し語のリストに対して**、アプリに載せるエントリを作る。

前提:
- 与えられるのは英語の見出し語だけである。意味・例文・関連語は**あなたが新しく書く**。既存の市販教材の訳語や例文を思い出して写さないこと。このアプリ独自の説明として、平易で自然な日本語と英文を書く。

ルール:
- word は見出し語を整えた形。単語は原形 (動詞は原形、名詞は単数形)。
  **熟語は目的語のプレースホルダを書かない。** 与えられた表記に \`~\` \`A\` \`B\` \`...\` があっても落とす
  (例: "a handful of ~" → "a handful of"、"accuse A of B" → "accuse of")。
  人を表す位置は someone、所有格は one's と書く (例: "give someone a hand", "change one's mind")。
- level はこの語を学ぶのにふさわしい CEFR を ${LEVELS.join(" / ")} から1つ。
  日本の大学受験〜英検準1級の語彙が中心なので B1〜C1 に寄るが、易しい語は下げてよい
- pos は品詞を日本語で (名詞/動詞/形容詞/副詞/前置詞/接続詞/熟語)
- meaningJa は最も代表的な日本語の意味 (簡潔に)
- distractors は4択の誤答3つ。同じ品詞の別語の意味で紛らわしいもの。meaningJa と意味が重なるものは不可
- exampleEn はその語の典型的な使い方が分かる短い例文。exampleJa はその和訳
- ipa はアメリカ英語のIPA発音記号。スラッシュで囲む (例: /əˈbʌndənt/)。熟語は全体の発音
- posEn は次から1つ: ${POS_EN.join(" / ")}
- domains は次から1〜3個: ${DOMAINS.join(" / ")}
- themes は次から1〜3個: ${THEMES.join(" / ")}
- exams は次から0〜4個 (特に頻出のものだけ。無理に埋めない): ${EXAMS.join(" / ")}
- related は派生語・関連語を0〜5個。同語根の派生を優先し、なければ類義語・対義語でよい
- **与えられた見出し語すべてに対して、順番どおりに1件ずつ返す。** 増やさない、減らさない
- domains / themes / exams / posEn は必ず上のリストの表記をそのまま使う`;

const client = new Anthropic();

// 実際の使用量を積む。**見積もりではなく実測を出す。**
// claude-opus-5 は 入力 $5 / 出力 $25 per MTok (2026-08 時点)。
// 思考トークンも出力として課金されるので、effort を変えるとここが動く
const PRICE_IN = 5 / 1_000_000;
const PRICE_OUT = 25 / 1_000_000;
const usage = { input: 0, output: 0, batches: 0 };
const costSoFar = () =>
  (usage.input * PRICE_IN + usage.output * PRICE_OUT).toFixed(2);

const dbPath = (kind, level) =>
  path.join("public", kind === "idiom" ? "english-idioms" : "english-words", `${level}.json`);

function loadDb(kind, level) {
  const p = dbPath(kind, level);
  if (!fs.existsSync(p)) return { level, generatedAt: new Date().toISOString(), count: 0, words: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const normKey = (w) =>
  w.normalize("NFKC").replace(/[^A-Za-z' -]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

// 既存の全見出し語 (語彙・イディオム・全レベル)。**重複を作らないための唯一の判定**
function existingKeys() {
  const set = new Set();
  for (const kind of ["word", "idiom"]) {
    for (const lv of LEVELS) {
      for (const e of loadDb(kind, lv).words) set.add(normKey(e.word));
    }
  }
  return set;
}

const pick = (arr, allowed) =>
  (Array.isArray(arr) ? arr : []).filter((v) => allowed.includes(v)).slice(0, 3);

async function generate(batch, attempt = 1) {
  try {
    const res = await client.messages
      .stream({
        model: "claude-opus-5",
        max_tokens: 30000,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content:
              `次の見出し語について、順番どおりにエントリを作れ。\n\n` +
              batch.map((t, i) => `${i + 1}. ${t.surface}`).join("\n"),
          },
        ],
        // **`effort` が費用の主レバー。** claude-opus-5 は thinking が既定でオンで、
        // 思考トークンも max_tokens に含まれ、出力として課金される
        // (入力 $5 / 出力 $25 per MTok)。ここは「与えられた見出し語に対して
        // 決まった形のエントリを作る」機械的な作業なので medium で足りる。
        // **最初の1バッチを --limit 30 で流して中身を見てから全体を回すこと。**
        // 品質が足りなければ high に上げる (費用はおおよそ比例して増える)
        output_config: {
          format: { type: "json_schema", schema: SCHEMA },
          effort: "medium",
        },
      })
      .finalMessage();
    if (res.usage) {
      usage.input += res.usage.input_tokens ?? 0;
      usage.output += res.usage.output_tokens ?? 0;
      usage.batches += 1;
    }
    if (res.stop_reason === "refusal") throw new Error("refusal");
    // **max_tokens 超過は「思考で使い切った」ことが多い。** 出 るようなら
    // BATCH を小さくするか effort を下げる
    if (res.stop_reason === "max_tokens") throw new Error("output truncated");
    const text = res.content.find((b) => b.type === "text")?.text ?? "";
    return JSON.parse(text).items ?? [];
  } catch (e) {
    if (attempt < 3) {
      console.warn(`  リトライ (${attempt}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 4000 * attempt));
      return generate(batch, attempt + 1);
    }
    console.error(`  バッチ失敗: ${e.message}`);
    return [];
  }
}

async function main() {
  const all = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
  const have = existingKeys();
  const todo = all.filter((t) => !have.has(normKey(t.surface.replace(/[~.]/g, " ")))).slice(0, LIMIT);

  console.log(`対象 ${all.length} 件 / 既存を除いて ${todo.length} 件を生成します`);
  console.log(`  単語 ${todo.filter((t) => t.kind === "word").length} / 熟語 ${todo.filter((t) => t.kind === "idiom").length}`);
  if (DRY) {
    console.log("--dry なのでここで終了。先頭10件:");
    for (const t of todo.slice(0, 10)) console.log(`  [${t.kind}] ${t.surface}`);
    return;
  }
  if (!todo.length) return;

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
  console.log(`  ${batches.length} バッチ (1バッチ ${BATCH} 件、並列 ${CONCURRENCY})`);

  const limit = pLimit(CONCURRENCY);
  // **書き込みは直列にする。** 並列に走らせると同じレベルのファイルを読み書きして
  // 取りこぼす。生成だけ並列にして、結果は順に反映する
  let done = 0, added = 0, skipped = 0;
  const seen = new Set(have);

  await Promise.all(
    batches.map((batch, bi) =>
      limit(async () => {
        const items = await generate(batch);
        // 期待した見出し語だけを採る。増やされた語は捨てる
        const wanted = new Map(batch.map((t) => [normKey(t.surface.replace(/[~.]/g, " ")), t]));
        const byLevel = new Map();
        for (const it of items) {
          if (!it.word || !it.meaningJa || !Array.isArray(it.distractors) || it.distractors.length !== 3) continue;
          const k = normKey(it.word);
          if (seen.has(k)) { skipped++; continue; }
          // 元のリストに無い語を勝手に足させない
          const src = wanted.get(k) ?? [...wanted.values()].find((t) => normKey(t.surface.replace(/[~.]/g, " ")).startsWith(k));
          if (!src) { skipped++; continue; }
          seen.add(k);
          const level = LEVELS.includes(it.level) ? it.level : "B1";
          const kind = src.kind;
          const entry = {
            word: it.word.trim(),
            pos: it.pos,
            meaningJa: it.meaningJa,
            distractors: it.distractors.slice(0, 3),
            exampleEn: it.exampleEn,
            exampleJa: it.exampleJa,
            ipa: typeof it.ipa === "string" ? it.ipa.trim() : "",
            posEn: POS_EN.includes(it.posEn) ? it.posEn : "",
            domains: pick(it.domains, DOMAINS),
            themes: pick(it.themes, THEMES),
            exams: pick(it.exams, EXAMS),
            related: (it.related ?? [])
              .filter((r) => r && r.word && r.meaningJa)
              .slice(0, 5)
              .map((r) => ({ word: r.word.trim(), meaningJa: r.meaningJa.trim() })),
          };
          const mk = `${kind}:${level}`;
          if (!byLevel.has(mk)) byLevel.set(mk, []);
          byLevel.get(mk).push(entry);
          added++;
        }
        // バッチごとに書き切る (途中で止めても続きから走らせられる)
        for (const [mk, entries] of byLevel) {
          const [kind, level] = mk.split(":");
          const db = loadDb(kind, level);
          db.words.push(...entries);
          db.words.sort((a, b) => a.word.localeCompare(b.word));
          db.count = db.words.length;
          db.expandedAt = new Date().toISOString();
          fs.writeFileSync(dbPath(kind, level), JSON.stringify(db, null, 1) + "\n");
        }
        done++;
        console.log(
          `  [${done}/${batches.length}] バッチ${bi + 1}: +${items.length}件 ` +
            `(累計 追加${added} / 除外${skipped} / 実測 $${costSoFar()})`,
        );
      }),
    ),
  );

  console.log(`\n完了: ${added} 件を追加、${skipped} 件を除外`);
  console.log(
    `実測: 入力 ${usage.input.toLocaleString()} / 出力 ${usage.output.toLocaleString()} トークン` +
      ` = $${costSoFar()} (${usage.batches} バッチ)`,
  );
  console.log("**public/english-sw.js の DATA_VERSION を上げること。**");
}

main();
