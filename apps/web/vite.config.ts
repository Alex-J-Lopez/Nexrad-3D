import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { defineConfig } from "vite";

// Cesium is hoisted to the monorepo root in this workspace.
const cesiumSource = "../../node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesium";

export default defineConfig({
  envDir: "../..",
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl },
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl },
      ],
    }),
  ],
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
  optimizeDeps: {
    include: ["cesium", "@cesium/engine", "@cesium/widgets", "mersenne-twister", "urijs"],
  },
});
