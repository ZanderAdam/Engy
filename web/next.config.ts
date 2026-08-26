import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', '@tobilu/qmd', 'node-llama-cpp', 'sherpa-onnx-node'],
};

export default nextConfig;
