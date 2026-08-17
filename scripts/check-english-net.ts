// readApiJson の検算。
// このリポジトリにはテスト基盤が無いので、単体でコンパイルして走らせる:
//
//   npx tsc scripts/check-english-net.ts lib/english/net.ts \
//     --outDir .tmp-check --target es2022 --module nodenext \
//     --moduleResolution nodenext --strict --skipLibCheck \
//   && node .tmp-check/scripts/check-english-net.js ; rm -rf .tmp-check
//
// いちばん大事なのは **どの入力でも JS の生の例外文が漏れないこと**。
// 元は `await res.json()` を裸で呼んでいて、本文がJSONでないときに
// SyntaxError の文面 (「Unexpected token '<'...」など) が画面の赤字に出ていた。
// 504・404・本文0バイトの500 が全部この経路を通る。
import { readApiJson, requestErrorMessage } from "../lib/english/net.js";

type Case = {
  name: string;
  status: number;
  body: string;
  contentType: string;
  // 期待: 成功するか、投げるか
  wantOk: boolean;
  // 投げる場合、文言に必ず含まれていてほしい断片
  wantContains?: string;
};

const FALLBACK = "生成に失敗しました";

const CASES: Case[] = [
  {
    name: "正常なJSON",
    status: 200,
    body: '{"title":"T","passageEn":"hello"}',
    contentType: "application/json",
    wantOk: true,
  },
  {
    name: "サーバーが用意した文言つきの400",
    status: 400,
    body: '{"error":"invalid level"}',
    contentType: "application/json",
    wantOk: false,
    wantContains: "invalid level",
  },
  {
    name: "本文0バイトの500 (未捕捉例外。本番で実測)",
    status: 500,
    body: "",
    contentType: "text/plain",
    wantOk: false,
    wantContains: "HTTP 500",
  },
  {
    name: "504 でHTMLが返る (maxDuration 超え)",
    status: 504,
    body: "<html><body>Gateway Timeout</body></html>",
    contentType: "text/html",
    wantOk: false,
    wantContains: "長さを短く",
  },
  {
    name: "404 でHTMLが返る (デプロイ中)",
    status: 404,
    body: "<!DOCTYPE html><html>Not Found</html>",
    contentType: "text/html",
    wantOk: false,
    wantContains: "再起動",
  },
  {
    name: "429 (レート制限)",
    status: 429,
    body: "",
    contentType: "text/plain",
    wantOk: false,
    wantContains: "少し待って",
  },
  {
    name: "503 (1日の上限)",
    status: 503,
    body: "",
    contentType: "text/plain",
    wantOk: false,
    wantContains: "受付を停止",
  },
  {
    name: "200 なのに中身がHTML (SW/プロキシがすり替えた)",
    status: 200,
    body: "<!DOCTYPE html><html>...</html>",
    contentType: "text/html",
    wantOk: false,
    wantContains: FALLBACK,
  },
  {
    name: "200 で JSON だが配列 (想定外の形)",
    status: 200,
    body: "[1,2,3]",
    contentType: "application/json",
    wantOk: false,
    wantContains: FALLBACK,
  },
];

// JSの生の例外文がそのまま出ていないかの見張り。
// 過去に画面へ出ていた文字列の特徴で判定する
const RAW_JS_ERROR = /Unexpected token|JSON\.parse|is not valid JSON|SyntaxError/i;

async function main() {
  let failed = 0;
  for (const c of CASES) {
    const res = new Response(c.body, {
      status: c.status,
      headers: { "content-type": c.contentType },
    });
    let ok = false;
    let message = "";
    try {
      await readApiJson<unknown>(res, FALLBACK);
      ok = true;
    } catch (e) {
      // 画面に出るのは requestErrorMessage を通した文字列なので、そこまで含めて見る
      message = requestErrorMessage(e, FALLBACK);
    }

    const problems: string[] = [];
    if (ok !== c.wantOk) {
      problems.push(ok ? "成功してしまった" : "失敗してしまった");
    }
    if (!ok) {
      if (c.wantContains && !message.includes(c.wantContains)) {
        problems.push(`「${c.wantContains}」を含まない`);
      }
      if (RAW_JS_ERROR.test(message)) {
        problems.push("**JSの生の例外文が漏れている**");
      }
      if (!message.trim()) problems.push("文言が空");
    }

    if (problems.length) {
      failed++;
      console.log(`NG  ${c.name}`);
      console.log(`      文言: ${message || "(成功)"}`);
      console.log(`      問題: ${problems.join(" / ")}`);
    } else {
      console.log(`ok  ${c.name}`);
      if (!ok) console.log(`      → ${message}`);
    }
  }

  console.log("");
  if (failed) {
    console.log(`${failed} 件が期待どおりでない`);
    process.exit(1);
  }
  console.log(`${CASES.length} 件すべて期待どおり`);
}

void main();
