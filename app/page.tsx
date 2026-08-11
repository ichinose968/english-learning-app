import { redirect } from "next/navigation";

// トップは英語学習アプリ本体へ
export default function Home() {
  redirect("/english");
}
