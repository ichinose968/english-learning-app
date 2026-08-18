import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor の設定。**appId は変えられない**（ストア上は別アプリ扱いになり、
// Android のクローズドテストの実績もやり直しになる）。docs 7章「決まっていること」。
//
// webDir は `npm run build:cap` が書き出す `out/`。
// **通常の `npm run build` では出ない**（無条件に `output: "export"` を書くと
// Vercel 側まで静的化されて読解APIが消えるため、`CAP_BUILD=1` のときだけ効かせている）。
// 同梱物を更新する手順は `npm run build:cap && npx cap sync android`。
const config: CapacitorConfig = {
  appId: "io.github.ichinose968.eng",
  appName: "Eng.",
  webDir: "out",
  // **このアプリは端末の設定によらず常にダーク。** WebView の地色を黒にしておかないと、
  // 起動直後のページを描く前の一瞬だけ白く光る（既定は白）。
  // 起動画面側は android/app/src/main/res の styles.xml で黒にしてある
  backgroundColor: "#000000",
};

export default config;
