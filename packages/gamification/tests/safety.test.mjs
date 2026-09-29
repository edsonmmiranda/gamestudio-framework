// Segurança de menores: conta de criança não compra, idade desconhecida é menor,
// sorte recusada para menor, chance que não soma 1 é recusada, compra real só existe
// como adaptador desligado.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadBundle, validateBundle } from "../src/catalog.js";
import { DAY_MS, HOUR_MS } from "../src/clock.js";
import { ageBand } from "../src/safety.js";
import { ADULT, bundle, game, match, rawExample, readExample, SEASON_START, stubAdapter } from "./_support.mjs";

const enableReal = (s) => { s.realPurchase.enabled = true; };
const enableLuck = (s) => { s.luck.enabled = true; };

test("idade desconhecida conta como menor; autodeclaração de adulto não basta por padrão", () => {
  const policy = bundle().sections.safety;
  assert.equal(ageBand({}, policy), "minor");
  assert.equal(ageBand({ age: null, ageSource: "unknown" }, policy), "minor");
  assert.equal(ageBand({ age: 30, ageSource: "unknown" }, policy), "minor");
  assert.equal(ageBand({ age: 30, ageSource: "declared" }, policy), "minor");
  assert.equal(ageBand({ age: 30, ageSource: "verified" }, policy), "adult");
  assert.equal(ageBand({ age: 15, ageSource: "verified" }, policy), "minor");
  assert.equal(ageBand({ age: 9, ageSource: "declared" }, policy), "child");
  assert.equal(ageBand({ age: 30, ageSource: "verified", childAccount: true }, policy), "child", "conta de criança vence a idade");
  assert.equal(ageBand({ age: 30, ageSource: "declared" }, { ...policy, trustSelfDeclaredAdult: true }), "adult");
});

test("conta de criança não compra, nem com catálogo e adaptador ligados", () => {
  const { adapter, calls } = stubAdapter();
  const { g } = game({ mutate: enableReal, adapter, profile: { age: 9, ageSource: "declared", childAccount: true } });
  const result = g.purchaseReal("passe.premium.real");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "child_account");
  assert.equal(calls.length, 0, "o adaptador nem é chamado");
  assert.equal(g.view().pass.premium, false);
});

test("menor sem responsável não compra; com responsável, para no limite do mês", () => {
  const { adapter, calls } = stubAdapter();
  const policyTwo = (s) => { enableReal(s); s.safety.minorMonthlyLimitCents = 2000; };
  const { g, clock } = game({ mutate: policyTwo, adapter, profile: { age: 15, ageSource: "verified" } });
  assert.equal(g.purchaseReal("passe.premium.real").reason, "minor_needs_guardian");
  g.setProfile({ guardianLinked: true });
  assert.equal(g.purchaseReal("passe.premium.real").ok, true);
  assert.equal(calls.length, 1);
  assert.equal(g.purchaseReal("passe.premium.real").reason, "minor_monthly_limit", "1490 + 1490 passa de 2000");
  clock.set(Date.parse("2026-11-02T12:00:00Z"));
  assert.notEqual(g.purchaseReal("passe.premium.real").reason, "minor_monthly_limit", "o mês novo zera o limite");
});

test("compra real: catálogo desligado recusa; adaptador padrão recusa; ninguém cobra", () => {
  const off = game({ profile: ADULT });
  assert.equal(off.g.purchaseReal("passe.premium.real").reason, "real_purchase_disabled");
  const on = game({ mutate: enableReal, profile: ADULT });
  assert.equal(on.g.purchaseReal("passe.premium.real").reason, "adapter_disabled");
  assert.equal(on.g.entries().some((entry) => entry.source === "real_purchase"), false);
});

test("compra real ligada no catálogo gera aviso de revisão jurídica", () => {
  const loaded = loadBundle(rawExample(enableReal));
  assert.equal(loaded.ok, true);
  assert.ok(loaded.warnings.some((warning) => warning.path === "sections.realPurchase.enabled"));
});

test("sorte desligada por padrão; ligada, é recusada para menor, criança e idade desconhecida", () => {
  assert.equal(readExample().sections.luck.enabled, false);
  assert.equal(game({ profile: ADULT }).g.pull("sorte.envelope").reason, "luck_disabled");
  for (const [profile, reason] of [
    [{}, "luck_minor"],
    [{ age: 30, ageSource: "declared" }, "luck_minor"],
    [{ age: 16, ageSource: "verified" }, "luck_minor"],
    [{ age: 8, ageSource: "verified" }, "luck_child"],
  ]) {
    const { g } = game({ mutate: enableLuck, profile });
    const before = g.entries().length;
    assert.equal(g.pull("sorte.envelope").reason, reason);
    assert.equal(g.entries().length, before, "nada é cobrado");
  }
});

test("sorte para adulto verificado: moeda ganha, chance à vista somando 100% e garantia na tirada escrita", () => {
  const { g, clock, bundle: b } = game({ mutate: enableLuck, profile: ADULT });
  for (let d = 0; g.balance("moedas") < 1500 && d < 40; d += 1) {
    clock.set(SEASON_START + d * DAY_MS + 3 * HOUR_MS);
    for (let i = 0; i < 12; i += 1) g.handle(match({ placement: 1, kills: 6 }));
  }
  const table = g.view().luck.tables[0];
  assert.equal(Math.round(table.odds.reduce((total, odd) => total + odd.percent, 0) * 1e6) / 1e6, 100);
  const after = b.sections.luck.tables[0].pity.after;
  const target = b.sections.luck.tables[0].pity.pool[0];
  let sinceHit = 0;
  let pulls = 0;
  for (let i = 0; i < 30 && g.balance("moedas") >= 100; i += 1) {
    const result = g.pull("sorte.envelope");
    pulls += 1;
    assert.equal(result.ok, true);
    sinceHit = result.outcome.item === target ? 0 : sinceHit + 1;
    assert.ok(sinceHit < after, `a garantia sai até a tirada ${after}`);
  }
  assert.ok(pulls > after, "tiradas suficientes para a garantia agir");
  assert.ok(g.entries().some((entry) => entry.sink === "luck"));
});

test("chance que não soma 1 é recusada na validação, nomeando o campo", () => {
  const raw = readExample("invalido-sorte-sem-soma.json");
  const result = validateBundle(raw);
  assert.equal(result.ok, false);
  const error = result.errors.find((item) => item.path === "sections.luck.tables[0].odds");
  assert.ok(error, "o erro nomeia sections.luck.tables[0].odds");
  assert.match(error.message, /somam 0\.9/);
});

test("sorte para menor ligada no catálogo, sorte paga ou com moeda comprável é recusada", () => {
  const minors = validateBundle(rawExample((s) => { s.safety.luckForMinors = true; }));
  assert.ok(minors.errors.some((error) => error.path === "sections.safety.luckForMinors" && /ECA Digital/.test(error.message)));
  const paid = validateBundle(rawExample((s) => { s.safety.paidLuck = true; }));
  assert.ok(paid.errors.some((error) => error.path === "sections.safety.paidLuck"));
  const bought = validateBundle(rawExample((s) => { s.currencies[0].purchasable = true; }));
  assert.ok(bought.errors.some((error) => error.path === "sections.luck.tables[0].currency"));
});
