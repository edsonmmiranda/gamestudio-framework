// Loja, cofre e ofertas: limite de compra, janela, posse duplicada vira o que o
// catálogo diz, rotação igual para todo jogador (sem segmentação).

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateBundle } from "../src/catalog.js";
import { DAY_MS, dayKey, HOUR_MS } from "../src/clock.js";
import { rotation } from "../src/store.js";
import { bundle, game, match, rawExample, SEASON_START } from "./_support.mjs";

function earn(g, clock, amount) {
  for (let d = 0; g.balance("moedas") < amount && d < 50; d += 1) {
    clock.set(SEASON_START + d * DAY_MS + 3 * HOUR_MS);
    for (let i = 0; i < 12; i += 1) g.handle(match({ placement: 1, kills: 6 }));
  }
}

const withOffer = (limit, from = "2026-10-01T09:00:00Z", to = "2026-10-20T09:00:00Z") => (s) => {
  s.offers.push({ id: "oferta.teste", version: 1, title: "Teste", validFrom: from, validTo: to, price: { currency: "moedas", amount: 10 }, grants: [{ currency: "fichas", amount: 5 }], limit });
};

test("limite de compra da oferta é respeitado", () => {
  const { g, clock } = game({ mutate: withOffer(2) });
  earn(g, clock, 100);
  clock.set(SEASON_START + 5 * HOUR_MS);
  assert.equal(g.buyOffer("oferta.teste").ok, true);
  assert.equal(g.buyOffer("oferta.teste").ok, true);
  const third = g.buyOffer("oferta.teste");
  assert.equal(third.ok, false);
  assert.equal(third.reason, "purchase_limit");
});

test("oferta fora da janela é recusada, antes e depois", () => {
  const { g, clock } = game({ mutate: withOffer(5, "2026-10-10T09:00:00Z", "2026-10-12T09:00:00Z") });
  earn(g, clock, 200);
  clock.set(Date.parse("2026-10-09T12:00:00Z"));
  assert.equal(g.buyOffer("oferta.teste").reason, "out_of_window");
  clock.set(Date.parse("2026-10-12T09:00:00Z"));
  assert.equal(g.buyOffer("oferta.teste").reason, "out_of_window");
  clock.set(Date.parse("2026-10-11T09:00:00Z"));
  assert.equal(g.buyOffer("oferta.teste").ok, true);
});

test("posse duplicada vira o que o catálogo diz (passe e oferta)", () => {
  const starter = "visual.protagonista.classico";
  const { g, clock, bundle: b } = game({
    mutate: (s) => {
      s.pass.tiers[0].free = [{ item: starter }];
      s.offers.push({ id: "oferta.dup", version: 1, title: "Dup", validFrom: "2026-10-01T09:00:00Z", validTo: "2026-11-26T09:00:00Z", price: { currency: "moedas", amount: 5 }, grants: [{ item: starter }], limit: 1 });
    },
  });
  const expected = b.index.cosmetics.get(starter).duplicate[0];
  assert.equal(g.owns(starter), true, "o item de início já é do jogador");
  for (let i = 0; i < 4; i += 1) g.handle(match({ placement: 1 }));
  const fromPass = g.entries().filter((entry) => entry.source === "duplicate" && entry.ref?.item === starter);
  assert.equal(fromPass.length, 1);
  assert.deepEqual([fromPass[0].currency, fromPass[0].delta], [expected.currency, expected.amount]);
  assert.equal(g.entries().filter((entry) => entry.item === starter).length, 1, "a posse não duplica");
  earn(g, clock, 10);
  assert.equal(g.buyOffer("oferta.dup").ok, true);
  assert.equal(g.entries().filter((entry) => entry.source === "duplicate" && entry.ref?.item === starter).length, 2);
});

test("comprar o que já é seu, o que não está na loja ou sem saldo é recusado", () => {
  const { g, clock, bundle: b } = game();
  const today = rotation(b.sections, dayKey(clock.now(), { resetHourUtc: 9 }));
  const outside = b.sections.store.rotation.pool.find((id) => !today.includes(id));
  assert.equal(g.buy("visual.protagonista.classico").reason, "already_owned");
  if (outside) assert.equal(g.buy(outside).reason, "not_in_store");
  assert.equal(g.buy(today[0]).reason, "insufficient_funds");
  earn(g, clock, 1500);
  const shelf = g.view().store.today.find((row) => !row.owned);
  const before = g.balance("moedas");
  assert.equal(g.buy(shelf.cosmetic.id).ok, true);
  assert.equal(g.balance("moedas"), before - shelf.price.amount);
  assert.equal(g.buy(shelf.cosmetic.id).reason, "already_owned");
});

test("o cofre traz de volta o que saiu de circulação", () => {
  const { g, clock } = game();
  const vault = g.view().store.vault.map((row) => row.cosmetic.id);
  assert.deepEqual(vault.sort(), ["visual.robo.classico", "visual.zumbi.classico"]);
  earn(g, clock, 400);
  assert.equal(g.buy("visual.robo.classico").ok, true);
  assert.ok(g.entries().some((entry) => entry.sink === "vault"));
});

test("propriedade: a rotação é igual para todo jogador e muda com o dia", () => {
  const b = bundle();
  const seen = new Set();
  for (let day = 20000; day < 20060; day += 1) {
    const one = rotation(b.sections, day);
    assert.deepEqual(rotation(b.sections, day), one, "sem entrada de jogador, sem loja 'só sua'");
    assert.equal(new Set(one).size, one.length);
    seen.add(one.join("|"));
  }
  assert.ok(seen.size > 5, "a rotação varia");
  const a = game({ playerId: "ana" }).g.view().store.today.map((row) => row.cosmetic.id);
  const c = game({ playerId: "caio", profile: { age: 40, ageSource: "verified" } }).g.view().store.today.map((row) => row.cosmetic.id);
  assert.deepEqual(a, c);
});

test("segmentação por gasto no catálogo é recusada com o motivo", () => {
  const result = validateBundle(rawExample((s) => { s.offers[0].segment = "IAPHighValue"; }));
  assert.equal(result.ok, false);
  const error = result.errors.find((item) => item.path === "sections.offers[0].segment");
  assert.match(error.message, /segmentação por gasto/);
  assert.match(error.message, /não existe no framework/);
});
