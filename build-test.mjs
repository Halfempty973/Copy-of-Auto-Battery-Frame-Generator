// Bundle the Node CAD smoke test to CJS so the emscripten glue (which mixes
// `export default` with `__dirname`) loads cleanly under Node 24's ESM loader.
//   node build-test.mjs && node test/out/smoke.cjs
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const entry = process.argv[2] || "test/node-cad-smoke.mjs";
const out = "test/out/" + entry.split("/").pop().replace(/\.mjs$/, ".cjs");

await esbuild.build({
  entryPoints: [join(__dirname, entry)],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: ["node20"],
  outfile: join(__dirname, out),
  // Keep the wasm out of the bundle; the test reads it from disk itself.
  external: ["*.wasm"],
  logLevel: "info",
});
console.log("Bundled " + out);
