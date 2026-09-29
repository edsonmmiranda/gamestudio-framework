// Esquemas: todo exemplo válido carrega (com o hash conferido); exemplo inválido falha
// com mensagem que nomeia o campo; o esquema publicado é o mesmo que o código usa.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { CATALOG_SCHEMA } from "../src/catalog-schema.js";
import { loadBundle, validateBundle } from "../src/catalog.js";
import { formatError } from "../src/schema.js";
import { rawExample, readExample } from "./_support.mjs";

const examples = readdirSync(new URL("../examples/", import.meta.url)).filter((name) => name.endsWith(".json"));

test("todo exemplo válido de examples/ carrega, com o hash declarado conferido", () => {
  const valid = examples.filter((name) => !name.startsWith("invalido-"));
  assert.ok(valid.length >= 2);
  for (const name of valid) {
    const raw = readExample(name);
    const loaded = loadBundle(raw);
    assert.equal(loaded.ok, true, `${name}: ${loaded.errors.map(formatError).join("; ")}`);
    assert.equal(loaded.bundle.hash, raw.hash, `${name}: hash declarado`);
  }
});

test("todo exemplo inválido de examples/ falha e o erro nomeia um campo", () => {
  const invalid = examples.filter((name) => name.startsWith("invalido-"));
  assert.ok(invalid.length >= 1);
  for (const name of invalid) {
    const result = validateBundle(readExample(name));
    assert.equal(result.ok, false, name);
    assert.ok(result.errors.every((error) => error.path.startsWith("sections.") || error.path === "hash"), `${name}: ${result.errors.map(formatError)}`);
  }
});

test("cada alteração inválida falha com o caminho do campo", () => {
  const cases = [
    ["sections.pass.tiers[2].xp", (s) => { s.pass.tiers[2].xp = 0; }, /≥ 1/],
    ["sections.currencies[0].name", (s) => { delete s.currencies[0].name; }, /obrigatório/],
    ["sections.season.validTo", (s) => { s.season.validTo = "2026-09-01T00:00:00Z"; }, /depois/],
    ["sections.season.validFrom", (s) => { s.season.validFrom = "1º de outubro"; }, /ISO 8601/],
    ["sections.surpresa", (s) => { s.surpresa = {}; }, /desconhecido/],
    ["sections.missions.pool[3].reward[0].currency", (s) => { s.missions.pool[3].reward[0].currency = "gemas"; }, /moeda desconhecida/],
    ["sections.store.rotation.pool[0]", (s) => { s.store.rotation.pool[0] = "visual.inexistente"; }, /item desconhecido/],
    ["sections.cosmetics[0].rarity", (s) => { s.cosmetics[0].rarity = "mitica"; }, /vocabulário/],
    ["sections.experiments[0].target", (s) => { s.experiments[0].target = "price"; }, /só de interface/],
    ["sections.pass.season", (s) => { s.pass.season = "t9"; }, /temporada/],
    ["sections.missions.pool[0].goal", (s) => { s.missions.pool[0].goal = { count: 1, sum: "kills", target: 3 }; }, /exatamente uma forma/],
    ["sections.dampers.trail.thresholds[2]", (s) => { s.dampers.trail.thresholds[2] = 10; }, /crescer/],
  ];
  for (const [path, mutate, message] of cases) {
    const result = validateBundle(rawExample(mutate));
    assert.equal(result.ok, false, path);
    const error = result.errors.find((item) => item.path === path);
    assert.ok(error, `esperava erro em ${path}; veio ${result.errors.map(formatError).join(" | ")}`);
    assert.match(error.message, message, path);
  }
});

test("hash declarado que não bate é recusado", () => {
  const raw = readExample();
  raw.sections.store.prices.comum += 1;
  const loaded = loadBundle(raw);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.errors[0].path, "hash");
});

test("o esquema publicado em schemas/ é o mesmo que o código usa", () => {
  const published = JSON.parse(readFileSync(new URL("../schemas/catalog.schema.json", import.meta.url), "utf8"));
  assert.deepEqual(published, JSON.parse(JSON.stringify(CATALOG_SCHEMA)), "rode node tools/export-schema.mjs");
});
