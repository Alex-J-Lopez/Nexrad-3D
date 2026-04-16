/**
 * Cesium 1.140+ pulls in `@spz-loader/core` for SPZ / Gaussian splat glTF.
 * That package ships Emscripten glue that Webpack minifies into invalid
 * template-literal escapes in the browser ("Octal escape sequences are not
 * allowed in template strings"). This app does not use SPZ content; we alias
 * the real module to this stub so the globe and primitives keep working.
 */
export async function loadSpz(
  _buffer: ArrayBufferView,
  _options?: unknown
): Promise<never> {
  throw new Error(
    "SPZ Gaussian splat decoding is not enabled in this build (see spz-loader-stub.ts)."
  );
}
