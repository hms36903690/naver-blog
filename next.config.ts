import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 네이티브 모듈·브라우저 자동화는 번들하지 않고 Node 에서 그대로 불러온다.
  serverExternalPackages: ["playwright", "playwright-core"],
  devIndicators: false,
};

export default nextConfig;
