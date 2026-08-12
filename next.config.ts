import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // iPhone実機 (WKWebView) からLAN経由で開発サーバーへアクセスするための許可
  allowedDevOrigins: ["192.168.0.244"],
};

export default nextConfig;
