// ワークフローが生成した単語・文法データを既存DBにマージする
// 使い方:
//   node scripts/merge-english-db.mjs words <task-output.json>
//   node scripts/merge-english-db.mjs grammar <task-output.json>
//
// 既存エントリは必ず保持する (学習記録が word / 問題id を参照しているため)。
// 単語はレベル間でも重複除去し、低いレベルを優先する。
import fs from "node:fs";
import path from "node:path";

const LEVELS = ["A1", "A2", "B1", "B2", "C1"];

function loadResult(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const result = raw.result ?? raw;
  if (!result || !Array.isArray(result.levels)) {
    throw new Error("想定外の形式: result.levels が見つかりません");
  }
  return result;
}

function normWord(w) {
  return w.trim().toLowerCase();
}

function normQuestion(q) {
  return q.trim().toLowerCase().replace(/\s+/g, " ").replace(/_+/g, "_");
}

function validWord(e) {
  return (
    e &&
    typeof e.word === "string" &&
    e.word.trim().length > 0 &&
    typeof e.meaningJa === "string" &&
    e.meaningJa.trim().length > 0 &&
    Array.isArray(e.distractors) &&
    e.distractors.length === 3 &&
    e.distractors.every((d) => typeof d === "string" && d.trim() && d.trim() !== e.meaningJa.trim()) &&
    typeof e.exampleEn === "string" &&
    typeof e.exampleJa === "string" &&
    typeof e.pos === "string"
  );
}

function validItem(it) {
  return (
    it &&
    typeof it.question === "string" &&
    it.question.includes("_") &&
    Array.isArray(it.choices) &&
    it.choices.length === 4 &&
    new Set(it.choices.map((c) => String(c).trim())).size === 4 &&
    Number.isInteger(it.answerIndex) &&
    it.answerIndex >= 0 &&
    it.answerIndex < 4 &&
    typeof it.explanationJa === "string" &&
    it.explanationJa.trim().length > 0 &&
    typeof it.topic === "string"
  );
}

function mergeWords(result, dirName = "english-words", preSeedDirs = []) {
  const seen = new Set(); // 全レベル横断の重複除去
  const stats = [];

  // 別部門のDBに既にある表現を除外する (例: イディオムは語彙DBの熟語と重複させない)
  for (const dir of preSeedDirs) {
    for (const level of LEVELS) {
      const f = path.join("public", dir, `${level}.json`);
      if (!fs.existsSync(f)) continue;
      for (const w of JSON.parse(fs.readFileSync(f, "utf8")).words ?? []) {
        seen.add(normWord(w.word));
      }
    }
  }

  // 既存を先に登録 (低いレベル優先の順に処理)
  const merged = {};
  for (const level of LEVELS) {
    const file = path.join("public", dirName, `${level}.json`);
    const existing = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8")).words ?? []
      : [];
    const kept = [];
    for (const w of existing) {
      const key = normWord(w.word);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.push(w);
    }
    merged[level] = kept;
  }

  // 新規を追加
  for (const level of LEVELS) {
    const lv = result.levels.find((l) => l.level === level);
    const incoming = lv?.entries ?? [];
    let added = 0;
    let rejected = 0;
    for (const e of incoming) {
      if (!validWord(e)) {
        rejected++;
        continue;
      }
      const key = normWord(e.word);
      if (seen.has(key)) continue;
      seen.add(key);
      merged[level].push({
        word: e.word.trim(),
        pos: e.pos.trim(),
        meaningJa: e.meaningJa.trim(),
        distractors: e.distractors.map((d) => d.trim()),
        exampleEn: e.exampleEn.trim(),
        exampleJa: e.exampleJa.trim(),
      });
      added++;
    }
    stats.push({ level, incoming: incoming.length, added, rejected, total: merged[level].length });
  }

  for (const level of LEVELS) {
    const out = {
      level,
      generatedAt: new Date().toISOString(),
      count: merged[level].length,
      words: merged[level],
    };
    fs.mkdirSync(path.join("public", dirName), { recursive: true });
    fs.writeFileSync(
      path.join("public", dirName, `${level}.json`),
      JSON.stringify(out, null, 1),
    );
  }
  return stats;
}

function mergeGrammar(result) {
  const stats = [];
  for (const level of LEVELS) {
    const file = path.join("public", "english-grammar", `${level}.json`);
    const existing = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8")).items ?? []
      : [];

    const seen = new Set(existing.map((it) => normQuestion(it.question)));
    // 既存idの最大連番を求め、新規はその続きから採番する (出題履歴を壊さないため)
    let maxIdx = -1;
    for (const it of existing) {
      const m = String(it.id).match(/-(\d+)$/);
      if (m) maxIdx = Math.max(maxIdx, Number(m[1]));
    }

    const lv = result.levels.find((l) => l.level === level);
    const incoming = lv?.items ?? [];
    const merged = [...existing];
    let added = 0;
    let rejected = 0;
    for (const it of incoming) {
      if (!validItem(it)) {
        rejected++;
        continue;
      }
      const key = normQuestion(it.question);
      if (seen.has(key)) continue;
      seen.add(key);
      maxIdx++;
      merged.push({
        id: `${level}-${maxIdx}`,
        topic: it.topic.trim(),
        question: it.question.trim(),
        choices: it.choices.map((c) => String(c).trim()),
        answerIndex: it.answerIndex,
        explanationJa: it.explanationJa.trim(),
      });
      added++;
    }

    const out = {
      level,
      generatedAt: new Date().toISOString(),
      count: merged.length,
      items: merged,
    };
    fs.writeFileSync(file, JSON.stringify(out, null, 1));

    const byTopic = {};
    for (const it of merged) byTopic[it.topic] = (byTopic[it.topic] ?? 0) + 1;
    stats.push({ level, incoming: incoming.length, added, rejected, total: merged.length, byTopic });
  }
  return stats;
}

const [kind, file] = process.argv.slice(2);
if (!kind || !file) {
  console.error("使い方: node scripts/merge-english-db.mjs <words|idioms|grammar> <task-output.json>");
  process.exit(1);
}

const result = loadResult(file);
const stats =
  kind === "words"
    ? mergeWords(result)
    : kind === "idioms"
      ? mergeWords(result, "english-idioms", ["english-words"])
      : mergeGrammar(result);

console.log(`=== ${kind} マージ結果 ===`);
let total = 0;
for (const s of stats) {
  total += s.total;
  const topics = s.byTopic
    ? ` [トピック数 ${Object.keys(s.byTopic).length}, 最少 ${Math.min(...Object.values(s.byTopic))}問]`
    : "";
  console.log(
    `${s.level}: 合計 ${s.total} (新規 +${s.added} / 受領 ${s.incoming} / 不正 ${s.rejected})${topics}`,
  );
}
console.log(`TOTAL: ${total}`);
