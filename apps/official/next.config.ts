import type { NextConfig } from "next";

// Shared code lives in @abuzar/core (packages/core); imports resolve via the
// tsconfig "@/*" alias. Turbopack finds it via the repo-root pnpm-lock.yaml.
const nextConfig: NextConfig = {
  transpilePackages: ["@abuzar/core"],
  // Security headers
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob:; " +
              "font-src 'self' data:; " +
              "connect-src 'self' https://*.vercel.app; " +
              "frame-ancestors 'none';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
