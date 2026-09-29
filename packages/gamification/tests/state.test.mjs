// Estado e instrumentação: salvar e restaurar sem perder nada, versão futura bloqueia,
// lançamento ilegível é separado; funil derivado do livro e A/B com início e fim.

import { test } from "node:test";
import assert from "node:assert/strict";

import { manualClock } from "../src/clock.js";
import { createGamification } from "../src/engine.js";
import { restore, STATE_SCHEMA } from "../src/state.js";
import { experimentState } from "../src/telemetry.js";
import { game, match, SEASON_START } from "./_support.mjs";

test("salvar e restaurar mantém saldo, posse, passe e missões", () => {
  const { g, clock, bundle } = game();
  for (let i = 0; i < 8; i += 1) g.handle(match({ placement: 1, kills: 4 }));
  const saved = JSON.stringify(g.save());
  const restored = restore(saved);
  assert.equal(restored.status, "ok");
  const again = createGamification({ bundle, clock: manualClock(clock.now()), state: restored.state });
  const a = g.view();
  const b = again.view();
  assert.equal(b.pass.xp, a.pass.xp);
  assert.deepEqual(b.wallet, a.wallet);
  assert.deepEqual(b.missions, a.missions);
  assert.equal(b.ledger.size, a.ledger.size);
  assert.equal(again.handle({ ...match(), id: g.entries().find((e) => e.source === "match").txId.split(":")[1] }).duplicate, true, "o evento visto antes continua visto");
});

test("estado de versão futura bloqueia; texto ilegível e lançamento inválido viram recuperação", () => {
  assert.equal(restore(JSON.stringify({ schema: STATE_SCHEMA + 1 })).status, "blocked");
  assert.equal(restore("{quebrado").status, "recovered");
  assert.equal(restore(null).status, "absent");
  const partial = restore({ schema: STATE_SCHEMA, ledger: [
    { txId: "a", at: 1, currency: "moedas", delta: 10, source: "match" },
    { txId: "b", at: 2, currency: "moedas", delta: -50, sink: "store" },
  ] });
  assert.equal(partial.status, "recovered");
  assert.equal(partial.state.ledger.length, 1);
  assert.equal(partial.rejected[0].reason, "insufficient_funds");
});

test("o funil sai do livro e das marcas, em ordem", () => {
  const { g } = game();
  for (let i = 0; i < 6; i += 1) g.handle(match({ placement: 1, kills: 6 }));
  const names = g.view().funnel.map((event) => event.name);
  assert.ok(names.includes("first_match"));
  assert.ok(names.includes("first_mission"));
  assert.ok(names.includes("pass_tier"));
  const times = g.view().funnel.map((event) => event.at);
  assert.deepEqual(times, times.slice().sort((a, b) => a - b));
});

test("A/B só vale entre o início e o fim, com variante estável por jogador", () => {
  const experiment = { id: "ab.x", startsAt: "2026-10-01T09:00:00Z", endsAt: "2026-10-29T09:00:00Z", variants: ["a", "b"] };
  assert.equal(experimentState(experiment, "ana", Date.parse("2026-09-30T00:00:00Z")).active, false);
  const during = experimentState(experiment, "ana", Date.parse("2026-10-10T00:00:00Z"));
  assert.equal(during.active, true);
  assert.equal(experimentState(experiment, "ana", Date.parse("2026-10-20T00:00:00Z")).variant, during.variant);
  assert.equal(experimentState(experiment, "ana", Date.parse("2026-10-29T09:00:00Z")).active, false);
  const { g } = game({ at: SEASON_START + 3600_000 });
  assert.equal(g.view().experiments[0].active, true);
});

test("evento inválido é recusado com o motivo, sem mexer em nada", () => {
  const { g } = game();
  const before = g.entries().length;
  for (const event of [
    { ...match(), id: "" },
    { ...match(), type: "match.won" },
    { ...match(), game: "xadrez" },
    { ...match(), placement: 11 },
    { ...match(), spend: 99 },
  ]) {
    const result = g.handle(event);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_event");
    assert.ok(result.detail);
  }
  assert.equal(g.entries().length, before);
});
