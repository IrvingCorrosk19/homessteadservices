import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["nodemailer", "better-sqlite3", "sharp"],
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
