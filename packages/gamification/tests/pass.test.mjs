// Passe: nunca passa do último tier, token limitado ao que falta, premium sem moeda
// suficiente é recusado, partida parada não paga, teto diário, sem cauda paga.

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateBundle } from "../src/catalog.js";
import { DAY_MS, HOUR_MS } from "../src/clock.js";
import { progressFor, tierFor, tokensAllowed, totalXp } from "../src/pass.js";
import { mulberry32 } from "../src/rng.js";
import { bundle, game, levelWon, match, rawExample, SEASON_END, SEASON_START } from "./_support.mjs";

test("propriedade: o XP nunca passa do total e o tier nunca passa do último nem volta", () => {
  for (let seed = 1; seed <= 6; seed += 1) {
    const { g, clock, bundle: b } = game();
    const rng = mulberry32(seed);
    const total = totalXp(b.sections.pass);
    let lastTier = 0;
    for (let i = 0; i < 700; i += 1) {
      if (rng() < 0.08) clock.advance(Math.floor(rng() * 20) * HOUR_MS);
      if (clock.now() >= SEASON_END) break;
      const event = rng() < 0.2
        ? levelWon({ stars: Math.floor(rng() * 4) })
        : match({ game: ["batalha", "corrida", "duelo", "cerco"][Math.floor(rng() * 4)], players: 8, placement: 1 + Math.floor(rng() * 8), kills: Math.floor(rng() * 9), durationS: Math.floor(rng() * 400) });
      g.handle(event);
      const view = g.view();
      assert.ok(view.pass.xp <= total, `XP ${view.pass.xp} passou de ${total}`);
      assert.ok(view.pass.progress.tier <= b.sections.pass.tiers.length);
      assert.ok(view.pass.progress.tier >= lastTier, "o tier não volta dentro da temporada");
      lastTier = view.pass.progress.tier;
    }
  }
});

test("tierFor e progressFor respeitam os limiares", () => {
  const pass = bundle().sections.pass;
  const first = pass.tiers[0].xp;
  assert.equal(tierFor(pass, first - 1), 0);
  assert.equal(tierFor(pass, first), 1);
  assert.equal(tierFor(pass, totalXp(pass) * 3), pass.tiers.length);
  assert.equal(progressFor(pass, totalXp(pass)).done, true);
});

test("propriedade: token de passe só vale o que falta para fechar", () => {
  const pass = bundle().sections.pass;
  const total = totalXp(pass);
  const rng = mulberry32(9);
  for (let i = 0; i < 1000; i += 1) {
    const xp = Math.floor(rng() * (total + 500));
    const offered = Math.floor(rng() * 200);
    const used = tokensAllowed(pass, xp, offered);
    assert.ok(used <= offered);
    const missing = Math.max(0, total - xp);
    assert.ok(used * pass.tokens.xpPerToken < missing + pass.tokens.xpPerToken, "no máximo um token de sobra para arredondar");
    if (missing === 0) assert.equal(used, 0);
  }
});

test("oferta com tokens perto do fim do passe usa só o que falta", () => {
  const { g, bundle: b } = game({
    mutate: (s) => {
      s.offers.push({ id: "oferta.tokens", version: 1, title: "Tokens", validFrom: "2026-10-01T09:00:00Z", validTo: "2026-11-26T09:00:00Z", price: { currency: "moedas", amount: 1 }, grants: [{ passTokens: 500 }], limit: 1 });
    },
  });
  for (let i = 0; i < 10; i += 1) g.handle(match({ placement: 1 }));
  const before = g.view().pass.xp;
  const result = g.buyOffer("oferta.tokens");
  assert.equal(result.ok, true);
  assert.ok(result.effects.some((effect) => effect.type === "tokens_limited" && effect.used < 500));
  assert.equal(g.view().pass.xp, totalXp(b.sections.pass));
  assert.ok(before < totalXp(b.sections.pass));
});

test("premium sem moeda suficiente é recusado e nada muda", () => {
  const { g } = game();
  const before = g.balance("moedas");
  const result = g.unlockPremium();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "insufficient_funds");
  assert.equal(g.balance("moedas"), before);
  assert.equal(g.view().pass.premium, false);
});

test("premium com moeda ganha libera a trilha e paga os tiers já alcançados uma vez só", () => {
  const { g, clock } = game();
  for (let d = 0; d < 30 && g.balance("moedas") < 1000; d += 1) {
    clock.set(SEASON_START + d * DAY_MS + 3 * HOUR_MS);
    for (let i = 0; i < 12; i += 1) g.handle(match({ placement: 1, kills: 6 }));
  }
  const tier = g.view().pass.progress.tier;
  assert.ok(g.balance("moedas") >= 1000);
  const result = g.unlockPremium();
  assert.equal(result.ok, true);
  const premiumEntries = () => g.entries().filter((entry) => entry.source === "pass_premium" || (entry.source === "duplicate" && entry.ref?.from === "pass_premium"));
  const tiersPaid = new Set(premiumEntries().map((entry) => entry.txId.split(":")[3]));
  assert.equal(tiersPaid.size, tier, "cada tier alcançado pagou a trilha premium");
  const count = premiumEntries().length;
  assert.equal(g.unlockPremium().reason, "premium_owned");
  assert.equal(premiumEntries().length, count, "liberar de novo não paga de novo");
  assert.ok(g.entries().some((entry) => entry.sink === "pass_premium" && entry.delta === -1000));
});

test("partida parada ou curta demais não paga XP, moeda nem missão (PunishThreshold)", () => {
  const { g } = game();
  const before = g.view();
  for (const event of [match({ durationS: 10 }), match({ idle: true, durationS: 300 })]) {
    const result = g.handle(event);
    assert.equal(result.idle, true);
  }
  const after = g.view();
  assert.equal(after.pass.xp, before.pass.xp);
  assert.equal(g.balance("moedas"), 0);
  assert.deepEqual(after.missions.daily.map((slot) => slot.progress), before.missions.daily.map((slot) => slot.progress));
});

test("o teto diário de XP de partida segura o dia e volta no dia seguinte", () => {
  const { g, clock, bundle: b } = game();
  const cap = b.sections.pass.xp.dailyCap;
  for (let i = 0; i < 30; i += 1) g.handle(match({ placement: 1 }));
  const view = g.view();
  assert.equal(view.pass.xpToday, cap);
  assert.ok(view.pass.xpLostToday > 0);
  clock.advance(DAY_MS);
  assert.equal(g.view().pass.xpToday, 0);
});

test("depois do fim não há cauda paga: nem XP, nem premium", () => {
  const { g, clock } = game();
  clock.set(SEASON_END + HOUR_MS);
  assert.equal(g.handle(match()).reason, "season_inactive");
  assert.equal(g.unlockPremium().reason, "season_inactive");
});

test("cauda paga no catálogo é recusada com o campo e o motivo", () => {
  const result = validateBundle(rawExample((s) => { s.pass.tail = [{ price: 14 }]; }));
  assert.equal(result.ok, false);
  const error = result.errors.find((item) => item.path === "sections.pass.tail");
  assert.match(error.message, /cauda paga/);
  assert.match(error.message, /recusada/);
});
