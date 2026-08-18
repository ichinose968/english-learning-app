import type { Metadata, Viewport } from "next";
import Link from "next/link";
import {
  ContactLink,
  DocList,
  DocPage,
  DocSection,
} from "@/components/english/DocPage";

// サポートページ。**両ストアとも問い合わせ先の掲載が必須**で、Google Play は
// サポート用のURLかメールアドレス、App Store はサポートURLを求める。
//
// 内容は「使い方の説明書」ではなく、**困ったときの窓口と、答えの分かっている質問**に絞る。
// 使い方はアプリ内のチュートリアル（設定 → チュートリアル）で見せる方針なので、
// ここに手順を写すと二重管理になり、必ず古くなる。
export const metadata: Metadata = {
  title: "サポート - Eng.",
  description:
    "英語学習アプリ Eng. のサポートページ。お問い合わせ先とよくある質問。",
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function SupportPage() {
  return (
    <DocPage title="サポート" updated="2026年8月18日">
      <p>
        英語学習アプリ Eng.
        についてのご質問、不具合のご報告、ご要望はメールでお送りください。個人で開発・運営しているため、返信までに数日いただくことがあります。
      </p>

      <DocSection heading="お問い合わせ先">
        <p>
          <ContactLink />
        </p>
        <p className="text-[13px] text-zinc-500">
          日本語または英語でお送りください。
        </p>
      </DocSection>

      <DocSection heading="不具合をお知らせいただくとき">
        <p>
          次の3つを添えていただけると、原因の特定がかなり速くなります。画面の写真があればなお助かります。
        </p>
        <DocList
          items={[
            "お使いの端末（例: iPhone 16 / Pixel 9）とOSのバージョン",
            "どの画面で、何をしたときに起きたか",
            "画面に出たメッセージがあれば、その文言",
          ]}
        />
      </DocSection>

      <DocSection heading="よくある質問">
        <div className="space-y-5">
          <Faq q="学習の記録はどこに保存されますか。">
            お使いの端末の中だけです。サーバーには送信しません。詳しくは
            <Link
              href="/english/privacy"
              className="text-[#4A99EA] underline underline-offset-2"
            >
              プライバシーポリシー
            </Link>
            をご覧ください。
          </Faq>

          <Faq q="機種変更するとき、記録を引き継げますか。">
            設定（歯車）→ 学習データ
            から書き出したファイルを、新しい端末で読み込んでください。
            <strong className="text-zinc-100">
              記録は端末の中だけにあるため、書き出しをせずにアプリを削除すると復元できません。
            </strong>
            アプリ版とブラウザ版でも記録は共有されません。
          </Faq>

          <Faq q="オフラインでも使えますか。">
            単語・イディオム・文法の問題はアプリに同梱されているため、通信がなくても出題されます。長文読解の生成だけは通信が必要です。
          </Faq>

          <Faq q="長文が生成できません。">
            通信状態をご確認のうえ、しばらく待ってからお試しください。生成には1日あたりの回数の上限があり、上限に達した場合もエラーになります。日付が変わると解除されます。
          </Faq>

          <Faq q="読み上げの音が出ません。">
            端末のマナーモードと音量をご確認ください。iPhone
            では、アプリを開いてから最初に画面のどこかに触れるまで音が出ないことがあります。カードを1枚めくってからお試しください。
          </Faq>

          <Faq q="単語のレベルを測り直したい。">
            カード画面の左上の設定（つまみのアイコン）→ 出題の設定 → 難易度
            (レベル)
            から、再測定できます。レベルは通常、直近の正答率に応じて自動で上下します。
          </Faq>

          <Faq q="使い方をもう一度見たい。">
            設定（歯車）→ チュートリアル
            から、いつでも最初の案内をやり直せます。
          </Faq>

          <Faq q="記録をすべて消したい。">
            設定（歯車）→ 学習データ
            からリセットできます。アプリを削除した場合も、端末内の記録はすべて消えます。
          </Faq>

          <Faq q="料金はかかりますか。">
            無料です。アプリ内に広告はありません。
          </Faq>
        </div>
      </DocSection>

      <DocSection heading="教材の内容について">
        <p>
          長文読解の文章と設問はAIが自動生成しています。内容に誤りが含まれることがありますので、学習の参考としてご利用ください。誤りを見つけた場合はお知らせいただけると助かります。
        </p>
      </DocSection>
    </DocPage>
  );
}

// 質問と答えの組。**答えを <p> ではなく div にしている**のは、中に箇条書きや
// リンクを入れても入れ子の規則を壊さないため
function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-bold text-zinc-100">{q}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
