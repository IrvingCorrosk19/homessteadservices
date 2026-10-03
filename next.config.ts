import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["nodemailer", "better-sqlite3", "sharp"],
  async headers() {
    return [
      {
        source: "/admin/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/admin/" },
        ],
      },
      {
        source: "/admin/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/contact": ["./node_modules/better-sqlite3/**/*"],
    "/api/admin/**": ["./node_modules/better-sqlite3/**/*"],
    "/api/media/**": ["./node_modules/better-sqlite3/**/*"],
    "/api/internal/**": [
      "./node_modules/better-sqlite3/**/*",
      "./node_modules/sharp/**/*",
      "./node_modules/@img/**/*",
    ],
    "/admin/**": ["./node_modules/better-sqlite3/**/*"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048],
    imageSizes: [64, 96, 128, 256, 384],
  },
};

export default nextConfig;
