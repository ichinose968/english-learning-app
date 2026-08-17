// 生成済みのエントリを既存の単語DBへ取り込む。**APIは呼ばない。**
//
//   node scripts/merge-english-expansion.mjs <生成物のディレクトリ> [--dry]
//
// 生成物は `[{ word, kind, level, pos, meaningJa, distractors, exampleEn,
// exampleJa, ipa, posEn, domains, themes, exams, related }, ...]` の JSON を
// 並べたディレクトリ。1ファイル1バッチでよい。
//
// **エントリを書くのは Claude 自身（このセッション）で、このスクリプトは
// 検証と取り込みだけを行う。** 以前ここからAPIを呼ぶ形にしていたが、
// 鍵が要るうえに遠回りだった。生成そのものは会話の中で分担して書く。
//
// 冪等: 既にDBにある見出し語は毎回スキップするので、同じ生成物を
// 何度取り込んでも重複しない。
//
// **DBを更新したら public/english-sw.js の DATA_VERSION を上げること。**
// 上げないと、導入済みの端末はキャッシュ優先で古いDBを持ち続ける。
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const srcDir = args.find((a) => !a.startsWith("--"));
const DRY = args.includes("--dry");
if (!srcDir) {
  console.error("使い方: node scripts/merge-english-expansion.mjs <生成物のディレクトリ> [--dry]");
  process.exit(1);
}

// **レベルを決め打ちしない。** ここを `["A1".."C1"]` と書いていたせいで、
// C2 を足した直後の取り込みが 1,073 件まるごと「level が不正」で弾かれた
// (幸い検算が止めたのでDBは無傷)。**存在するDBファイルからレベルを導く**ので、
// 新しいレベルは JSON を1つ置けば自動的に通る
function detectLevels() {
  const dir = path.join("public", "english-words");
  const found = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5))
    : [];
  // CEFR の順に並べ、知らない表記は後ろに回す
  const order = ["A1", "A2", "B1", "B2", "C1", "C2"];
  return found.sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

const LEVELS = detectLevels();
const POS_EN = ["Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction", "Phrase"];
const DOMAINS = ["Business", "Academic", "DailyLife", "Travel", "Medical", "Legal",
  "Technical", "News", "Literary", "Casual"];
const THEMES = ["Technology", "Finance", "Sports", "Environment", "Health", "Politics",
  "Education", "Food", "Art", "Science", "Society", "Work", "Family",
  "Nature", "History", "Law", "Psychology", "Entertainment"];
const EXAMS = ["TOEIC", "TOEFL", "英検", "IELTS", "高校受験", "共通テスト", "難関大入試"];

const dbPath = (kind, level) =>
  path.join("public", kind === "idiom" ? "english-idioms" : "english-words", `${level}.json`);

function loadDb(kind, level) {
  const p = dbPath(kind, level);
  if (!fs.existsSync(p)) {
    return { level, generatedAt: new Date().toISOString(), count: 0, words: [] };
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// 重複判定の唯一の基準。記号と大文字小文字の違いを吸収する
const normKey = (w) =>
  String(w).normalize("NFKC").replace(/[^A-Za-z' -]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

function existingKeys() {
  const set = new Set();
  for (const kind of ["word", "idiom"]) {
    for (const lv of LEVELS) for (const e of loadDb(kind, lv).words) set.add(normKey(e.word));
  }
  return set;
}

const pickFrom = (arr, allowed, max) =>
  (Array.isArray(arr) ? arr : []).filter((v) => allowed.includes(v)).slice(0, max);

const str = (v) => (typeof v === "string" ? v.trim() : "");

// 1件を検証して整える。**弾いた理由を必ず返す**ので、
// 取りこぼしが「黙って消えた」にならない
function normalize(raw) {
  const word = str(raw?.word);
  if (!word) return { error: "word が空" };
  const level = LEVELS.includes(raw.level) ? raw.level : null;
  if (!level) return { error: `level が不正 (${raw.level})`, word };
  const meaningJa = str(raw.meaningJa);
  if (!meaningJa) return { error: "meaningJa が空", word };
  const distractors = (Array.isArray(raw.distractors) ? raw.distractors : [])
    .map(str).filter(Boolean).slice(0, 3);
  if (distractors.length !== 3) return { error: `distractors が3つでない (${distractors.length})`, word };
  const exampleEn = str(raw.exampleEn);
  const exampleJa = str(raw.exampleJa);
  if (!exampleEn || !exampleJa) return { error: "例文が空", word };
  // 熟語かどうかは生成側の申告ではなく**見出し語の形**で決める。
  // 申告に頼ると、同じ語が語彙とイディオムの両方に入りうる
  const kind = word.trim().includes(" ") ? "idiom" : "word";
  return {
    kind,
    level,
    entry: {
      word,
      pos: str(raw.pos),
      meaningJa,
      distractors,
      exampleEn,
      exampleJa,
      ipa: str(raw.ipa),
      posEn: POS_EN.includes(raw.posEn) ? raw.posEn : "",
      domains: pickFrom(raw.domains, DOMAINS, 3),
      themes: pickFrom(raw.themes, THEMES, 3),
      exams: pickFrom(raw.exams, EXAMS, 4),
      related: (Array.isArray(raw.related) ? raw.related : [])
        .filter((r) => r && str(r.word) && str(r.meaningJa))
        .slice(0, 5)
        .map((r) => ({ word: str(r.word), meaningJa: str(r.meaningJa) })),
    },
  };
}

function main() {
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) {
    console.error(`${srcDir} に .json がありません`);
    process.exit(1);
  }

  const have = existingKeys();
  console.log(`既存DB: ${have.size} 語 / 生成物: ${files.length} ファイル`);

  const seen = new Set(have);
  const buckets = new Map(); // "kind:level" -> entries[]
  const stats = { read: 0, added: 0, dupInDb: 0, dupInBatch: 0, invalid: 0 };
  const problems = [];

  for (const f of files) {
    let items;
    try {
      items = JSON.parse(fs.readFileSync(path.join(srcDir, f), "utf8"));
    } catch (e) {
      problems.push(`${f}: JSONとして読めない (${e.message})`);
      continue;
    }
    if (!Array.isArray(items)) {
      problems.push(`${f}: 配列ではない`);
      continue;
    }
    for (const raw of items) {
      stats.read++;
      const n = normalize(raw);
      if (n.error) {
        stats.invalid++;
        problems.push(`${f}: ${n.word ?? "(語不明)"} — ${n.error}`);
        continue;
      }
      const k = normKey(n.entry.word);
      if (have.has(k)) { stats.dupInDb++; continue; }
      if (seen.has(k)) { stats.dupInBatch++; continue; }
      seen.add(k);
      const mk = `${n.kind}:${n.level}`;
      if (!buckets.has(mk)) buckets.set(mk, []);
      buckets.get(mk).push(n.entry);
      stats.added++;
    }
  }

  console.log(`\n読み込み ${stats.read} 件`);
  console.log(`  取り込む      : ${stats.added}`);
  console.log(`  既にDBにある  : ${stats.dupInDb}`);
  console.log(`  生成物内の重複: ${stats.dupInBatch}`);
  console.log(`  不正で除外    : ${stats.invalid}`);

  if (problems.length) {
    console.log(`\n除外の内訳 (先頭20件):`);
    for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
    if (problems.length > 20) console.log(`  ... 他 ${problems.length - 20} 件`);
  }

  console.log(`\n振り分け:`);
  for (const [mk, entries] of [...buckets].sort()) {
    console.log(`  ${mk}: +${entries.length}`);
  }

  if (DRY) {
    console.log("\n--dry なので書き込みませんでした。");
    return;
  }

  for (const [mk, entries] of buckets) {
    const [kind, level] = mk.split(":");
    const db = loadDb(kind, level);
    db.words.push(...entries);
    db.words.sort((a, b) => a.word.localeCompare(b.word));
    db.count = db.words.length;
    db.expandedAt = new Date().toISOString();
    fs.writeFileSync(dbPath(kind, level), JSON.stringify(db, null, 1) + "\n");
    console.log(`  書き込み: ${dbPath(kind, level)} (${db.count} 語)`);
  }

  console.log("\n**public/english-sw.js の DATA_VERSION を上げること。**");
}

main();
