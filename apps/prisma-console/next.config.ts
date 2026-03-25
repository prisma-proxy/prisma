import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  experimental: {
    optimizeCss: true,
  },
};

export default nextConfig;
