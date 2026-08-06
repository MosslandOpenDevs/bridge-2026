/**
 * Server startup hook, run before any route module is evaluated.
 *
 * Node 25 exposes a `localStorage` global even though there is no `window`,
 * and unless the process was started with `--localstorage-file` that object
 * has no methods (`localStorage.getItem` is undefined). Browser libraries
 * feature-detect storage with a bare `typeof localStorage !== "undefined"`,
 * so during SSR they find the global, call it, and throw — which rendered
 * every page as a 500 on Node 25.
 *
 * Removing the misleading global on the server restores the "no Web Storage
 * here" answer those checks expect. The property is configurable, so this is
 * a plain delete.
 */
export async function register() {
  if (typeof window !== "undefined") return;

  for (const name of ["localStorage", "sessionStorage"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!descriptor) continue;

    // Only remove Node's unusable stub; leave a working implementation alone
    // (a future Node, or a polyfill someone deliberately installed).
    let usable = false;
    try {
      usable =
        typeof (globalThis as Record<string, any>)[name]?.getItem === "function";
    } catch {
      usable = false;
    }
    if (usable) continue;

    if (descriptor.configurable) {
      delete (globalThis as Record<string, unknown>)[name];
    } else {
      Object.defineProperty(globalThis, name, {
        value: undefined,
        configurable: true,
      });
    }
  }
}
