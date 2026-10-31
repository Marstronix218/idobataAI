// Module hooks that let plain Node import src/lib/characters/*.ts, so the
// content scripts run the real linter and schemas rather than a copy. Node
// strips the types itself (on by default from 22.18; package.json passes
// --experimental-strip-types for 22.13-22.17). These hooks only add what the
// bundler normally does: resolve extensionless relative imports from a .ts file
// to the .ts file, and mark .ts files as ES modules.
//
// Register with: register("./lib/typescript-hooks.mjs", import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  let result;
  try {
    result = await nextResolve(specifier, context);
  } catch (error) {
    const relativeFromTs = /^\.{1,2}\//.test(specifier) && context.parentURL?.endsWith(".ts");
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !relativeFromTs) throw error;
    result = await nextResolve(`${specifier}.ts`, context);
  }
  return result.url.endsWith(".ts") ? { ...result, format: "module-typescript" } : result;
}
