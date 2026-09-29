#!/usr/bin/env node
// Refaz o hash de um catálogo depois de editar à mão.
// Uso: node tools/rehash.mjs <catalogo.json> [--check]
// Com --check, só confere: sai com 1 se o hash declarado não bate.

import { readFileSync, writeFileSync } from "node:fs";
import { loadBundle } from "../src/catalog.js";
import { formatError } from "../src/schema.js";

const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
const checkOnly = args.includes("--check");
if (!file) {
  console.error("uso: node tools/rehash.mjs <catalogo.json> [--check]");
  process.exit(2);
}
const raw = JSON.parse(readFileSync(file, "utf8"));
const declared = raw.hash;
delete raw.hash;
const loaded = loadBundle(raw);
if (!loaded.ok) {
  for (const error of loaded.errors) console.error(formatError(error));
  process.exit(1);
}
if (checkOnly) {
  const ok = declared === loaded.bundle.hash;
  console.log(ok ? `hash confere: ${declared}` : `hash declarado ${declared ?? "(nenhum)"}, calculado ${loaded.bundle.hash}`);
  process.exit(ok ? 0 : 1);
}
const ordered = {};
for (const key of Object.keys(raw)) {
  ordered[key] = raw[key];
  if (key === "version") ordered.hash = loaded.bundle.hash;
}
if (!ordered.hash) ordered.hash = loaded.bundle.hash;
writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
console.log(`${file}: hash ${loaded.bundle.hash}`);
