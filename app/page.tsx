import { redirect } from "next/navigation";

// このリポジトリは英語学習アプリ単体なので、ルートは学習画面へ送る
export default function Home() {
  redirect("/english");
}
