// Livro-razão: nunca negativo, idempotente, soma = saldo, origem obrigatória.
// Propriedades com sequências aleatórias semeadas e um controle negativo: um livro
// sem regras, alimentado com as mesmas operações, precisa ser pego pelo verificador.

import { test } from "node:test";
import assert from "node:assert/strict";

import { checkLedger, createLedger, SINKS, SOURCES } from "../src/ledger.js";
import { mulberry32 } from "../src/rng.js";
import { sum } from "./_support.mjs";

const CURRENCIES = ["moedas", "fichas", "estrelas"];
const sourceList = Object.keys(SOURCES);
const sinkList = Object.keys(SINKS);

function randomOp(rng, i, previous) {
  const roll = rng();
  if (previous.length && roll < 0.1) return { ...previous[Math.floor(rng() * previous.length)] }; // repete o mesmo txId
  if (previous.length && roll < 0.14) return { ...previous[Math.floor(rng() * previous.length)], delta: 999 }; // conflito
  const currency = CURRENCIES[Math.floor(rng() * CURRENCIES.length)];
  const credit = rng() < 0.55;
  const amount = 1 + Math.floor(rng() * 60);
  return credit
    ? { txId: `t${i}`, at: i, currency, delta: amount, source: sourceList[Math.floor(rng() * sourceList.length)] }
    : { txId: `t${i}`, at: i, currency, delta: -amount, sink: sinkList[Math.floor(rng() * sinkList.length)] };
}

test("propriedade: saldo nunca negativo, soma dos lançamentos = saldo, repetir não muda nada", () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const rng = mulberry32(seed);
    const ledger = createLedger();
    const sent = [];
    for (let i = 0; i < 400; i += 1) {
      const op = randomOp(rng, i, sent);
      const before = ledger.size();
      const result = ledger.post(op);
      if (result.ok && !result.duplicate) sent.push(op);
      if (!result.ok) assert.equal(ledger.size(), before, "lançamento recusado não entra");
      for (const currency of CURRENCIES) assert.ok(ledger.balance(currency) >= 0, `saldo negativo em ${currency} (semente ${seed})`);
    }
    const entries = ledger.entries();
    assert.equal(checkLedger(entries).ok, true);
    for (const currency of CURRENCIES) {
      const total = sum(entries.filter((entry) => entry.currency === currency).map((entry) => entry.delta));
      assert.equal(ledger.balance(currency), total, "saldo é a soma do livro");
    }
    const size = ledger.size();
    for (const entry of entries) assert.equal(ledger.post(entry).duplicate, true, "mesmo txId e conteúdo é idempotente");
    assert.equal(ledger.size(), size);
    const replay = createLedger(entries);
    for (const currency of CURRENCIES) assert.equal(replay.balance(currency), ledger.balance(currency), "restaurar dá o mesmo saldo");
  }
});

test("origem e sumidouro são obrigatórios e de vocabulário fechado", () => {
  const ledger = createLedger();
  assert.equal(ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 5 }).reason, "source_required");
  assert.equal(ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 5, source: "presente" }).reason, "source_unknown");
  assert.equal(ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 5, source: "match", sink: "store" }).reason, "sink_on_credit");
  assert.equal(ledger.post({ txId: "b", at: 1, currency: "moedas", delta: -5 }).reason, "sink_required");
  assert.equal(ledger.post({ txId: "b", at: 1, currency: "moedas", delta: -5, sink: "ralo" }).reason, "sink_unknown");
  assert.equal(ledger.post({ txId: "c", at: 1, delta: 5, source: "match" }).reason, "asset_required");
  assert.equal(ledger.post({ txId: "c", at: 1, currency: "moedas", item: "x", delta: 5, source: "match" }).reason, "asset_required");
  assert.equal(ledger.post({ at: 1, currency: "moedas", delta: 5, source: "match" }).reason, "txid_required");
  assert.equal(ledger.post({ txId: "d", at: 1, currency: "moedas", delta: 1.5, source: "match" }).reason, "delta_invalid");
  assert.equal(ledger.size(), 0);
});

test("débito sem saldo é recusado e o saldo fica como estava", () => {
  const ledger = createLedger();
  ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 10, source: "match" });
  const refused = ledger.post({ txId: "b", at: 2, currency: "moedas", delta: -11, sink: "store" });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "insufficient_funds");
  assert.equal(ledger.balance("moedas"), 10);
});

test("mesmo txId com conteúdo diferente é conflito, não sobrescrita", () => {
  const ledger = createLedger();
  ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 10, source: "match" });
  assert.equal(ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 50, source: "match" }).reason, "txid_conflict");
  assert.equal(ledger.balance("moedas"), 10);
});

test("transação com várias pernas entra inteira ou não entra", () => {
  const ledger = createLedger();
  ledger.post({ txId: "a", at: 1, currency: "moedas", delta: 100, source: "match" });
  const refused = ledger.postAll("compra", [
    { at: 2, item: "visual.x", delta: 1, source: "store" },
    { at: 2, currency: "moedas", delta: -150, sink: "store" },
  ]);
  assert.equal(refused.ok, false);
  assert.equal(ledger.owns("visual.x"), false, "a posse não entra sem o pagamento");
  const ok = ledger.postAll("compra", [
    { at: 2, currency: "moedas", delta: -60, sink: "store" },
    { at: 2, item: "visual.x", delta: 1, source: "store" },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ledger.postAll("compra", [
    { at: 2, currency: "moedas", delta: -60, sink: "store" },
    { at: 2, item: "visual.x", delta: 1, source: "store" },
  ]).duplicate, true);
  assert.equal(ledger.balance("moedas"), 40);
});

test("totais separam fonte, gasto e vencimento", () => {
  const ledger = createLedger();
  ledger.post({ txId: "a", at: 1, currency: "fichas", delta: 30, source: "mission" });
  ledger.post({ txId: "b", at: 2, currency: "fichas", delta: -10, sink: "offer" });
  ledger.post({ txId: "c", at: 3, currency: "fichas", delta: -20, sink: "expiry" });
  const row = ledger.totals().currencies.fichas;
  assert.deepEqual([row.sourced, row.spent, row.expired, row.balance], [30, 10, 20, 0]);
});

test("controle negativo: um livro sem regras com as mesmas operações é pego pelo verificador", () => {
  const rng = mulberry32(7);
  const naive = [];
  for (let i = 0; i < 400; i += 1) naive.push(randomOp(rng, i, naive));
  const report = checkLedger(naive);
  assert.equal(report.ok, false);
  const kinds = new Set(report.problems.map((problem) => problem.problem));
  assert.ok(kinds.has("negative_balance"), "o verificador acha saldo negativo");
  assert.ok(kinds.has("txid_repeated"), "o verificador acha txId repetido");
});
