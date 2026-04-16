import type { NextConfig } from "next";
import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cesium is hoisted to the monorepo root node_modules
const cesiumSource = path.resolve(
  __dirname,
  "../../node_modules/cesium/Build/Cesium"
);

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
  env: {
    NEXT_PUBLIC_CESIUM_BASE_URL: "/_next/static/cesium",
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@spz-loader/core": spzLoaderStub,
    };

    if (!isServer) {
      config.plugins.push(
        new CopyWebpackPlugin({
          patterns: [
            { from: path.join(cesiumSource, "Workers"), to: "static/cesium/Workers" },
            { from: path.join(cesiumSource, "Assets"), to: "static/cesium/Assets" },
            { from: path.join(cesiumSource, "Widgets"), to: "static/cesium/Widgets" },
            { from: path.join(cesiumSource, "ThirdParty"), to: "static/cesium/ThirdParty" },
          ],
        })
      );

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
