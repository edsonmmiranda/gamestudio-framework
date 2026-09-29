#!/usr/bin/env node
// Simulador de economia pela linha de comando.
//
// Uso:
//   node tools/simulate.mjs [catalogo.json] [--personas p.json] [--criteria c.json]
//                           [--seeds 1,2,3] [--series] [--summary]
// Sem catálogo, usa examples/temporada-exemplo.json. Sai com 0 quando o catálogo
// passa nos critérios e com 1 quando falha (o catálogo quebrado precisa sair com 1).

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../src/catalog.js";
import { formatError } from "../src/schema.js";
import { DEFAULT_PERSONAS, DEFAULT_SEEDS, simulateSeason, summarize } from "../src/simulate.js";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const positional = args.filter((arg, i) => !arg.startsWith("--") && !["--personas", "--criteria", "--seeds"].includes(args[i - 1]));
const file = positional[0] ?? join(here, "../examples/temporada-exemplo.json");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const loaded = loadBundle(readJson(file));
if (!loaded.ok) {
  console.error(`catálogo inválido: ${file}`);
  for (const error of loaded.errors) console.error(`  ${formatError(error)}`);
  process.exit(1);
}
for (const warning of loaded.warnings) console.error(`aviso: ${formatError(warning)}`);

const report = simulateSeason(loaded.bundle, {
  personas: option("--personas") ? readJson(option("--personas")) : DEFAULT_PERSONAS,
  criteria: option("--criteria") ? readJson(option("--criteria")) : {},
  seeds: option("--seeds") ? option("--seeds").split(",").map(Number) : DEFAULT_SEEDS,
  series: args.includes("--series"),
});
console.log(JSON.stringify(args.includes("--summary") ? summarize(report) : report, null, 2));
process.exit(report.pass ? 0 : 1);
