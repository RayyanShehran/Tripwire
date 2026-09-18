import type { NextConfig } from "next";
import { dirname } from "path";
import { fileURLToPath } from "url";

const currentDir = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingRoot: currentDir,
};

export default nextConfig;
