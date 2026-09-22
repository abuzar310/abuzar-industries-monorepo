import type { NextConfig } from "next";

// Shared code lives in @abuzar/core (packages/core); imports resolve via the
// tsconfig "@/*" alias. Turbopack finds it via the repo-root pnpm-lock.yaml.
// Testing mix of unofficial + official. Redeploy when either app's pages change.
const nextConfig: NextConfig = {
  transpilePackages: ["@abuzar/core", "@univerjs/preset-sheets-core", "@univerjs/presets"],
};

export default nextConfig;
