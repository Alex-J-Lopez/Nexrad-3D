/**
 * Must execute before any `import "cesium"` so Web Workers resolve under
 * `/_next/static/cesium` (CopyWebpackPlugin output). Otherwise Primitives with
 * `asynchronous: true` throw: "Must define either _workerName or _workerPath".
 */
declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

if (typeof window !== "undefined") {
  window.CESIUM_BASE_URL =
    process.env.NEXT_PUBLIC_CESIUM_BASE_URL ?? "/_next/static/cesium";
}

export {};
