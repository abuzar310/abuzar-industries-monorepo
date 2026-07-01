import type { NextConfig } from "next";

// Shared code lives in @abuzar/core (packages/core); imports resolve via the
// tsconfig "@/*" alias. Turbopack finds it via the repo-root pnpm-lock.yaml.
const nextConfig: NextConfig = {
  transpilePackages: ["@abuzar/core"],
};

export default nextConfig;
