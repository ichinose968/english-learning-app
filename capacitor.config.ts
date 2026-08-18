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
  plugins: {
    // Capacitor 8 に内蔵のシステムバー制御（別途プラグインを入れる必要は無い）。
    SystemBars: {
      // **`DARK` は「地が暗い」という意味で、アイコンは白になる。**
      // 既定 (`DEFAULT`) は端末のライト/ダーク設定に従うので、端末がライトだと
      // アイコンが黒く描かれ、**黒いこのアプリの上で時計も電池も見えなくなる**
      // （エミュレータで実測。Web 側で踏んだ「黒地に黒」と同じ罠）。
      // テーマの `windowLightStatusBar` と MainActivity での指定より、
      // **この設定のほうが後に効く**ので、ここが実質の決定点になる
      style: "DARK",
      // 既定のまま。Android では `--safe-area-inset-*` を注入してくれるが、
      // このアプリが使っているのは `env(safe-area-inset-*)` のほう。
      // **切り替えるときは両方を突き合わせて実測すること**（値がずれると
      // ヘッダーが時計に潜るか、下タブが浮く）
      insetsHandling: "css",
    },
  },
};

export default config;
