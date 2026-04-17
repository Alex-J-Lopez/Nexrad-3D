import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Real @spz-loader/core breaks client bundles (Emscripten + template literals). */
const spzLoaderStub = path.join(__dirname, "lib/spz-loader-stub.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    resolveAlias: {
      "@spz-loader/core": spzLoaderStub,
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@spz-loader/core": spzLoaderStub,
    };

    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        http: false,
        https: false,
        url: false,
      };
    }

    return config;
  },
};

export default nextConfig;
