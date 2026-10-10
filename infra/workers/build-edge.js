#!/usr/bin/env node
const path = require("path");
const esbuild = require("../../plugin/node_modules/esbuild");
const raiz = __dirname;
(async () => {
  await esbuild.build({
    entryPoints: [path.join(raiz, "edge-worker-entry.js")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    legalComments: "none",
    minify: true,
    outfile: path.join(raiz, "edge-worker.js"),
    logLevel: "info"
  });
})().catch((erro) => { console.error(erro && erro.stack || erro); process.exit(1); });
