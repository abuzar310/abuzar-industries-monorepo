import type { NextConfig } from "next";

// Shared code lives in @abuzar/core (packages/core); imports resolve via the
// tsconfig "@/*" alias. Turbopack finds it via the repo-root pnpm-lock.yaml.
// Redeploy trigger: ship #22 (quote print blank page) + #23 (manager cloak).
const nextConfig: NextConfig = {
  transpilePackages: ["@abuzar/core", "@univerjs/preset-sheets-core", "@univerjs/presets"],
};

export default nextConfig;
