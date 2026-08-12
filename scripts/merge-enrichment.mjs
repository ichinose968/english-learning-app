// セッション内で生成した詳細情報 (scratchpad/enrich/out*.json) をDBへ取り込む
// 使い方: node scripts/merge-enrichment.mjs <enrichディレクトリ>
import fs from "node:fs";
import path from "node:path";

const DIRS = ["english-words", "english-idioms"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

const DOMAINS = [
  "Business", "Academic", "DailyLife", "Travel", "Medical", "Legal",
  "Technical", "News", "Literary", "Casual",
];
const THEMES = [
  "Technology", "Finance", "Sports", "Environment", "Health", "Politics",
  "Education", "Food", "Art", "Science", "Society", "Work", "Family",
  "Nature", "History", "Law", "Psychology", "Entertainment",
];
const EXAMS = ["TOEIC", "TOEFL", "英検", "IELTS", "高校受験", "共通テスト", "難関大入試"];
const POS_EN = [
  "Noun", "Verb", "Adjective", "Adverb", "Preposition", "Conjunction",
  "Pronoun", "Phrasal Verb", "Idiom", "Phrase",
];

const enrichDir = process.argv[2];
if (!enrichDir) {
  console.error("使い方: node scripts/merge-enrichment.mjs <enrichディレクトリ>");
  process.exit(1);
}

// 生成物を読み込む (壊れたJSONはスキップして報告)
const byWord = new Map();
let files = 0;
let broken = [];
for (const f of fs.readdirSync(enrichDir).filter((f) => /^out\d+-[a-z]\.json$/.test(f))) {
  const raw = fs.readFileSync(path.join(enrichDir, f), "utf8");
  let arr;
  try {
    arr = JSON.parse(raw);
  } catch {
    broken.push(f);
    continue;
  }
  if (!Array.isArray(arr)) {
    broken.push(f);
    continue;
  }
  files++;
  for (const it of arr) {
    if (it && typeof it.word === "string") {
      byWord.set(it.word.trim().toLowerCase(), it);
    }
  }
}

const pick = (arr, allowed) =>
  [...new Set((arr ?? []).map((x) => String(x).trim()))].filter((x) => allowed.includes(x));

let applied = 0;
let missing = [];
for (const dir of DIRS) {
  for (const level of LEVELS) {
    const file = path.join("public", dir, `${level}.json`);
    if (!fs.existsSync(file)) continue;
    const db = JSON.parse(fs.readFileSync(file, "utf8"));
    let changed = 0;
    for (const w of db.words) {
      if (w.ipa) continue;
      const it = byWord.get(w.word.toLowerCase());
      if (!it) {
        missing.push(`${dir}/${level}/${w.word}`);
        continue;
      }
      w.ipa = typeof it.ipa === "string" ? it.ipa.trim() : "";
      w.posEn = POS_EN.includes(it.posEn) ? it.posEn : "";
      w.domains = pick(it.domains, DOMAINS);
      w.themes = pick(it.themes, THEMES);
      w.exams = pick(it.exams, EXAMS);
      w.related = (it.related ?? [])
        .filter((r) => r && typeof r.word === "string" && typeof r.meaningJa === "string")
        .slice(0, 5)
        .map((r) => ({ word: r.word.trim(), meaningJa: r.meaningJa.trim() }));
      if (!w.ipa) delete w.ipa; // 発音が空なら未付与のままにする
      else changed++;
    }
    if (changed > 0) {
      db.enrichedAt = new Date().toISOString();
      fs.writeFileSync(file, JSON.stringify(db, null, 1));
    }
    applied += changed;
    console.log(`${dir}/${level}: +${changed}`);
  }
}

console.log(`\n読み込みファイル: ${files}件 / 生成語彙: ${byWord.size}語`);
if (broken.length) console.log(`壊れたJSON: ${broken.join(", ")}`);
console.log(`適用: ${applied}語 / 未取得: ${missing.length}語`);
if (missing.length) {
  fs.writeFileSync(path.join(enrichDir, "missing.json"), JSON.stringify(missing, null, 1));
  console.log(`未取得リスト: ${path.join(enrichDir, "missing.json")}`);
}
