// Build the self-contained single-file HTML for the Battery Frame Generator.
//
//   node build.mjs           -> dist/Battery Frame Generator.html  (+ copy to project root)
//
// The OpenCascade wasm (~10.4 MB) is inlined via esbuild's "binary" loader
// (decoded to a Uint8Array at runtime and handed to opencascade({wasmBinary})),
// so the finished HTML fetches nothing and runs from file://.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The emscripten glue references require("fs"/"path"/"crypto") only inside its
// ENVIRONMENT_IS_NODE branch, which never runs in a browser. Stub them so the
// browser bundle resolves cleanly.
const stubNodeBuiltins = {
  name: "stub-node-builtins",
  setup(build) {
    const builtins = /^(fs|path|crypto|url|module|worker_threads|os|util|stream)$/;
    build.onResolve({ filter: builtins }, (args) => ({
      path: args.path,
      namespace: "stub-node",
    }));
    build.onLoad({ filter: /.*/, namespace: "stub-node" }, () => ({
      contents: "export default {}; export const __esModule = true;",
      loader: "js",
    }));
  },
};

async function buildApp() {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, "src/main.js")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome109", "edge109"],
    minify: true,
    write: false,
    legalComments: "none",
    loader: { ".wasm": "binary" },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.url": '"file:///"',
    },
    plugins: [stubNodeBuiltins],
    logLevel: "info",
  });

  const js = result.outputFiles[0].text;
  // esbuild escapes "</script" inside string literals, but assert to be safe.
  if (/<\/script/i.test(js)) {
    throw new Error("Bundle contains an unescaped </script — would break the HTML.");
  }

  let template = readFileSync(join(__dirname, "src/template.html"), "utf8");

  // Inline the Inter font as base64 @font-face so the look is consistent
  // offline / on any OS. Replaces the <!--FONTS--> placeholder.
  const fontFaces = [400, 500, 600, 700]
    .map((w) => {
      const b64 = readFileSync(
        join(__dirname, `src/assets/fonts/inter-${w}.woff2`)
      ).toString("base64");
      return (
        `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};` +
        `font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');}`
      );
    })
    .join("");
  template = template.replace("<!--FONTS-->", () => `<style>${fontFaces}</style>`);

  // Replacer FUNCTION so $-sequences in the minified JS are not treated as
  // replacement patterns.
  const html = template.replace(
    "<!--APP_JS-->",
    () => "<script>\n" + js + "\n</script>"
  );

  mkdirSync(join(__dirname, "dist"), { recursive: true });
  const distPath = join(__dirname, "dist/Battery Frame Generator.html");
  writeFileSync(distPath, html);
  // Copy to project root as the primary deliverable.
  const rootPath = join(__dirname, "Battery Frame Generator.html");
  copyFileSync(distPath, rootPath);

  const mb = (html.length / 1024 / 1024).toFixed(1);
  console.log(`Built ${distPath} (${mb} MB)`);
  console.log(`Copied to ${rootPath}`);
}

buildApp().catch((e) => {
  console.error(e);
  process.exit(1);
});
