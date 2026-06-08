import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', '@tobilu/qmd', 'node-llama-cpp'],
};

export default nextConfig;
