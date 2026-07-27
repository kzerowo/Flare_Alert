import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 모노레포에서 workspace 패키지를 참조하므로 루트를 명시한다.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
};

export default nextConfig;
