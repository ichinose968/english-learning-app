// 復習の重み付けと、復習タブの件数の検算。
// このリポジトリにはテスト基盤が無いので、単体でコンパイルして走らせる:
//
//   npx tsc scripts/check-english-queue.ts lib/english/{worddb,types}.ts \
//     --outDir .tmp-check --target es2022 --module nodenext \
//     --moduleResolution nodenext --strict --skipLibCheck \
//   && node .tmp-check/scripts/check-english-queue.js ; rm -rf .tmp-check
//
// いちばん大事なのは「復習タブに出る件数」と「buildQueue(review) が実際に拾う
// 語の集合」が一致すること。ここがズレる不整合を過去に何度も踏んでいる。
import {
  buildQueue,
  dbStats,
  reviewWeight,
} from "../lib/english/worddb";
import {
  DEFAULT_VOCAB_SETTINGS,
  VocabAction,
  VocabEntry,
  WordDbEntry,
} from "../lib/english/types";

const fail: string[] = [];
const ok = (cond: boolean, msg: string) => {
  if (!cond) fail.push(msg);
};

const NOW = new Date("2026-08-13T00:00:00.000Z");
const past = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();

function entry(over: Partial<VocabEntry> = {}): VocabEntry {
  return {
    word: over.word ?? "w",
    level: "B1",
    meaningJa: "いみ",
    knownCount: 0,
    unsureCount: 0,
    unknownCount: 0,
    correctCount: 0,
    wrongCount: 0,
    needsReview: false,
    lastSeenAt: past,
    history: [],
    ...over,
  };
}

// ---- 1. 重み: × が多いほど重く、× は △ より重い ----

// 未回答は最小
ok(reviewWeight(undefined) === 1, "未回答の重みが1でない");

// × の回数で単調に増える
const xN = (n: number) =>
  reviewWeight(
    entry({
      unknownCount: n,
      history: Array(n).fill({ t: past, r: "unknown" as VocabAction }),
    }),
  );
ok(xN(1) < xN(2) && xN(2) < xN(5), `× の回数で重みが増えない: ${xN(1)}, ${xN(2)}, ${xN(5)}`);

// △ の回数でも増える
const dN = (n: number) =>
  reviewWeight(
    entry({
      unsureCount: n,
      wrongCount: n,
      history: Array(n).fill({ t: past, r: "unsure_wrong" as VocabAction }),
    }),
  );
ok(dN(1) < dN(3), `△ の回数で重みが増えない: ${dN(1)}, ${dN(3)}`);

// 同じ回数なら × は △ より重い (「特に×」の要件)
ok(xN(3) > dN(3), `同じ3回でも × (${xN(3)}) が △ (${dN(3)}) より重くない`);

// △ の中では、4択まで外した方が当てた方より重い
const wrong1 = reviewWeight(
  entry({ unsureCount: 1, wrongCount: 1, history: [{ t: past, r: "unsure_wrong" }] }),
);
const correct1 = reviewWeight(
  entry({ unsureCount: 1, correctCount: 1, history: [{ t: past, r: "unsure_correct" }] }),
);
ok(wrong1 > correct1, `△→誤答 (${wrong1}) が △→正解 (${correct1}) より重くない`);

// 直近の結果の上乗せ: 同じ回数でも、最後が × の語は最後が ○ の語より重い
const lastX = reviewWeight(
  entry({
    unknownCount: 1,
    knownCount: 1,
    history: [
      { t: past, r: "known" },
      { t: past, r: "unknown" },
    ],
  }),
);
const lastO = reviewWeight(
  entry({
    unknownCount: 1,
    knownCount: 1,
    history: [
      { t: past, r: "unknown" },
      { t: past, r: "known" },
    ],
  }),
);
ok(lastX > lastO, `直近 × (${lastX}) が直近 ○ (${lastO}) より重くない`);

// ---- 2. 復習タブの件数と buildQueue(review) の集合が一致するか ----

const def = (w: string): WordDbEntry => ({
  word: w,
  pos: "名詞",
  meaningJa: `${w}のいみ`,
  distractors: ["a", "b", "c"],
  exampleEn: `This is ${w}.`,
  exampleJa: "れい",
});
const words = ["a", "b", "c", "d", "e"].map(def);
const dbs = Object.fromEntries(
  (["A1", "A2", "B1", "B2", "C1"] as const).map((lv) => [
    lv,
    {
      level: lv,
      generatedAt: NOW.toISOString(),
      count: lv === "B1" ? words.length : 0,
      words: lv === "B1" ? words : [],
    },
  ]),
) as Parameters<typeof buildQueue>[0];

const progress: Record<string, VocabEntry> = {
  // 学習中 (前回 ×)
  a: entry({ word: "a", unknownCount: 1, needsReview: true, history: [{ t: past, r: "unknown" }] }),
  // 学習中 (前回 △)
  b: entry({ word: "b", unsureCount: 1, wrongCount: 1, history: [{ t: past, r: "unsure_wrong" }] }),
  // 学習完了 (初見○) → 復習には出ない
  c: entry({ word: "c", knownCount: 1, history: [{ t: past, r: "known" }] }),
};

const master = DEFAULT_VOCAB_SETTINGS.masterKnownCount;
const stats = dbStats(dbs, ["B1"], progress, master);
ok(stats.learning === 2, `learning がおかしい: ${stats.learning}`);
ok(stats.done === 1, `done がおかしい: ${stats.done}`);

// buildQueue(review) が拾える語の集合を、十分大きい size で全部引いて確かめる
const q = buildQueue(dbs, ["B1"], progress, DEFAULT_VOCAB_SETTINGS, "review", 100, NOW);
const got = [...new Set(q.map((w) => w.word))].sort();
ok(
  JSON.stringify(got) === JSON.stringify(["a", "b"]),
  `復習が拾った語: ${got.join(",")} (期待: a,b)`,
);
ok(
  q.length === stats.learning,
  `復習の件数と実際の出題数が不一致: ${q.length} vs ${stats.learning}`,
);

// 未学習 d, e は演習側にだけ出る
const q2 = buildQueue(dbs, ["B1"], progress, DEFAULT_VOCAB_SETTINGS, "drill", 100, NOW);
ok(q2.some((w) => w.word === "d"), "演習に未学習の語が出ていない");

// ---- 3. 重みが実際の出題頻度に効くか (weightedSample を大数で回す) ----
// × を5回出した語と、△→正解1回の語を1枚ずつ引かせて、どちらが先頭に来るかを数える。
// 重み比はおよそ (1+15+4) : (1+1+2) = 20 : 4 なので、× 側が8割前後で先に出るはず
const heavy = entry({
  word: "a",
  unknownCount: 5,
  history: Array(5).fill({ t: past, r: "unknown" as VocabAction }),
});
const light = entry({
  word: "b",
  unsureCount: 1,
  correctCount: 1,
  history: [{ t: past, r: "unsure_correct" }],
});
const p2: Record<string, VocabEntry> = { a: heavy, b: light };
let heavyFirst = 0;
const TRIALS = 3000;
for (let i = 0; i < TRIALS; i++) {
  const one = buildQueue(dbs, ["B1"], p2, DEFAULT_VOCAB_SETTINGS, "review", 1, NOW);
  if (one[0]?.word === "a") heavyFirst++;
}
const ratio = heavyFirst / TRIALS;
ok(
  ratio > 0.72 && ratio < 0.95,
  `× の多い語が先頭に来る割合が想定外: ${(ratio * 100).toFixed(1)}% (期待 約83%)`,
);

console.log(
  fail.length === 0
    ? `OK (×多い語が先頭に来た割合: ${(ratio * 100).toFixed(1)}%)`
    : `NG:\n- ${fail.join("\n- ")}`,
);
process.exit(fail.length === 0 ? 0 : 1);
