import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.prestocks.com" },
      { protocol: "https", hostname: "prestocks.com" },
    ],
  },
};

export default nextConfig;
