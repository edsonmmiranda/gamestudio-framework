// Simulador: a temporada de exemplo passa nos critérios; o controle negativo (fonte
// sem sumidouro, passe impossível) precisa falhar; o resultado é determinístico.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { loadBundle } from "../src/catalog.js";
import { analyzeCatalog, cosmeticPaths, DEFAULT_PERSONAS, passXpUpperBound, simulateSeason } from "../src/simulate.js";
import { readExample } from "./_support.mjs";

const load = (name) => {
  const loaded = loadBundle(readExample(name));
  assert.equal(loaded.ok, true);
  return loaded.bundle;
};
const report = simulateSeason(load("temporada-exemplo.json"), { series: false });

test("a temporada de exemplo passa em todos os critérios", () => {
  assert.equal(report.pass, true, report.checks.filter((item) => !item.ok).map((item) => item.detail).join("\n"));
  const casual = report.personas.find((persona) => persona.id === "casual");
  assert.ok(casual.freeClosedDay <= Math.floor(0.8 * casual.seasonDays), "casual fecha o grátis em até 80% da temporada no pior caso");
  for (const id of ["regular", "dedicado"]) {
    assert.notEqual(report.personas.find((persona) => persona.id === id).premiumClosedDay, null, `${id} fecha o premium com moeda ganha`);
  }
  assert.equal(report.static.cosmetics.share, 1, "todo cosmético da temporada tem caminho sem dinheiro real");
});

test("o relatório traz as medidas pedidas para cada persona", () => {
  assert.deepEqual(report.personas.map((persona) => persona.id), DEFAULT_PERSONAS.map((persona) => persona.id));
  for (const persona of report.personas) {
    for (const key of ["freeClosedDay", "freeClosedDayMedian", "premiumClosedDay", "premiumUnlockedDay", "currencies", "cosmetics", "capEffect", "bySeed"]) {
      assert.ok(key in persona, `${persona.id}.${key}`);
    }
    for (const row of Object.values(persona.currencies)) assert.ok("inflation" in row && "final" in row && "sourced" in row && "spent" in row);
  }
  const dedicated = report.personas.find((persona) => persona.id === "dedicado");
  assert.ok(dedicated.capEffect.passXpLost > 0, "o teto diário age sobre quem joga muito");
});

test("controle negativo: catálogo quebrado falha, e falha pelos motivos certos", () => {
  const broken = simulateSeason(load("catalogo-quebrado.json"), { series: false, seeds: [1, 2] });
  assert.equal(broken.pass, false);
  const failed = new Set(broken.checks.filter((item) => !item.ok).map((item) => item.id));
  assert.ok(failed.has("sumidouro:estrelas"), "fonte sem sumidouro");
  assert.ok(failed.has("passe_possivel"), "passe impossível");
  assert.ok(failed.has("casual_fecha_gratis"));
  assert.ok([...failed].some((id) => id.startsWith("moeda_parada:") && id.endsWith(":estrelas")));
});

test("controle negativo do critério: apertar o limite do casual faz a mesma temporada falhar", () => {
  const strict = simulateSeason(load("temporada-exemplo.json"), { series: false, seeds: [1, 2], criteria: { casualFreeMaxFraction: 0.3 } });
  assert.equal(strict.pass, false);
  assert.equal(strict.checks.find((item) => item.id === "casual_fecha_gratis").ok, false);
});

test("mesma semente, mesmo relatório", () => {
  const bundle = load("temporada-exemplo.json");
  const a = simulateSeason(bundle, { seeds: [3], series: true });
  const b = simulateSeason(bundle, { seeds: [3], series: true });
  assert.deepEqual(a, b);
});

test("análise estática: origens e sumidouros por moeda, teto de XP e caminhos dos cosméticos", () => {
  const sections = load("temporada-exemplo.json").sections;
  const flow = analyzeCatalog(sections);
  assert.ok(flow.moedas.sources.includes("partida") && flow.moedas.sinks.includes("loja"));
  assert.deepEqual(flow.fichas.sinks, ["oferta"]);
  assert.ok(passXpUpperBound(sections).bound > 0);
  assert.equal(cosmeticPaths(sections).total, sections.cosmetics.filter((c) => c.season === "t1").length);
});

test("a linha de comando sai com 0 no exemplo e com 1 no catálogo quebrado", () => {
  const tool = fileURLToPath(new URL("../tools/simulate.mjs", import.meta.url));
  const example = fileURLToPath(new URL("../examples/temporada-exemplo.json", import.meta.url));
  const broken = fileURLToPath(new URL("../examples/catalogo-quebrado.json", import.meta.url));
  const ok = JSON.parse(execFileSync(process.execPath, [tool, example, "--summary", "--seeds", "1,2"], { encoding: "utf8" }));
  assert.equal(ok.pass, true);
  const failed = spawnSync(process.execPath, [tool, broken, "--summary", "--seeds", "1"], { encoding: "utf8" });
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).pass, false);
});
