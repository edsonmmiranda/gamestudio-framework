// Missões: completam uma vez, troca grátis uma por dia, evento repetido não paga
// duas vezes, uma partida atualiza todas as missões que casam.

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateBundle } from "../src/catalog.js";
import { DAY_MS } from "../src/clock.js";
import { conditionHolds } from "../src/missions.js";
import { mulberry32 } from "../src/rng.js";
import { game, match, rawExample } from "./_support.mjs";

// Três missões do dia, todas da batalha: o teste controla o que está ativo.
const onlyBattle = (s) => {
  s.missions.pool = s.missions.pool.filter((m) => m.cycle !== "daily");
  const reward = [{ currency: "moedas", amount: 20 }, { passXp: 100 }];
  s.missions.pool.push(
    { id: "d.teste.partidas", version: 1, cycle: "daily", game: "batalha", title: "Jogue 2", when: "match.finished", goal: { count: 2 }, reward },
    { id: "d.teste.metade", version: 1, cycle: "daily", game: "batalha", title: "Metade", when: "match.finished", where: [{ field: "placement", op: "<=", ref: "players", times: 0.5 }], goal: { count: 1 }, reward },
    { id: "d.teste.abates", version: 1, cycle: "daily", game: "batalha", title: "Abates", when: "match.finished", goal: { sum: "kills", target: 4 }, reward },
    { id: "d.teste.fases", version: 1, cycle: "daily", game: "fases", title: "Fases", when: "level.won", goal: { count: 1 }, reward },
  );
  s.missions.daily.slots = 3;
  s.firstTime = [];
  s.dampers.consolation.afterLosses = 99;
};

const missionEntries = (g) => g.entries().filter((entry) => entry.source === "mission");

test("uma partida atualiza todas as missões que casam de uma vez", () => {
  const { g } = game({ mutate: onlyBattle });
  const ids = g.view().missions.daily.map((slot) => slot.id).sort();
  const battle = ["d.teste.abates", "d.teste.metade", "d.teste.partidas"].filter((id) => ids.includes(id));
  g.handle(match({ placement: 2, kills: 4 }));
  const view = g.view().missions.daily;
  for (const id of battle) assert.ok(view.find((slot) => slot.id === id).progress > 0, `${id} andou`);
});

test("missão completa uma vez: a meta cumprida não paga de novo", () => {
  const { g } = game({ mutate: onlyBattle });
  for (let i = 0; i < 6; i += 1) g.handle(match({ placement: 1, kills: 3 }));
  const paid = missionEntries(g).length;
  for (let i = 0; i < 6; i += 1) g.handle(match({ placement: 1, kills: 3 }));
  assert.equal(missionEntries(g).length, paid);
  const done = g.view().missions.daily.filter((slot) => slot.done);
  assert.ok(done.length >= 2, "as missões da batalha foram cumpridas");
  const byMission = new Map();
  for (const entry of missionEntries(g).filter((e) => e.currency === "moedas")) byMission.set(entry.ref.mission, (byMission.get(entry.ref.mission) ?? 0) + 1);
  for (const slot of done) assert.equal(byMission.get(slot.id), 1, `${slot.id} pagou uma vez`);
});

test("propriedade: evento repetido (mesmo id) não paga nem avança duas vezes", () => {
  const rng = mulberry32(21);
  const { g } = game({ mutate: onlyBattle });
  const sent = [];
  for (let i = 0; i < 200; i += 1) {
    const event = sent.length && rng() < 0.4 ? sent[Math.floor(rng() * sent.length)] : match({ placement: 1 + Math.floor(rng() * 10), kills: Math.floor(rng() * 5) });
    const size = g.entries().length;
    const progress = JSON.stringify(g.view().missions);
    const result = g.handle(event);
    if (sent.includes(event)) {
      assert.equal(result.duplicate, true);
      assert.equal(g.entries().length, size, "o livro não cresce com a repetição");
      assert.equal(JSON.stringify(g.view().missions), progress, "o progresso não anda com a repetição");
    } else {
      sent.push(event);
    }
  }
});

test("troca grátis: uma por dia, nunca paga, volta no dia seguinte", () => {
  const { g, clock } = game({ mutate: onlyBattle });
  const before = g.view().missions.daily.map((slot) => slot.id);
  const first = g.reroll(0);
  assert.equal(first.ok, true);
  assert.notDeepEqual(g.view().missions.daily.map((slot) => slot.id), before);
  const second = g.reroll(1);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "reroll_limit");
  assert.equal(g.balance("moedas"), 0, "trocar não cobra nada");
  clock.advance(DAY_MS);
  assert.equal(g.view().missions.rerollsLeft, 1);
  assert.equal(g.reroll(0).ok, true);
});

test("missão cumprida não pode ser trocada", () => {
  const { g } = game({ mutate: onlyBattle });
  for (let i = 0; i < 6; i += 1) g.handle(match({ placement: 1, kills: 5 }));
  const index = g.view().missions.daily.findIndex((slot) => slot.done);
  assert.ok(index >= 0);
  assert.equal(g.reroll(index).reason, "mission_done");
});

test("as missões do dia renovam na virada e são as mesmas para todo jogador", () => {
  const a = game({ playerId: "ana" });
  const b = game({ playerId: "bia" });
  assert.deepEqual(a.g.view().missions.daily.map((slot) => slot.id), b.g.view().missions.daily.map((slot) => slot.id));
  a.g.handle(match({ placement: 1 }));
  a.clock.advance(DAY_MS);
  const renewed = a.g.view().missions.daily;
  assert.ok(renewed.every((slot) => slot.progress === 0 && !slot.done));
});

test("condição com referência compara com o campo do próprio evento", () => {
  const top = { field: "placement", op: "<=", ref: "players", times: 0.5 };
  assert.equal(conditionHolds(top, { placement: 5, players: 10 }), true);
  assert.equal(conditionHolds(top, { placement: 6, players: 10 }), false);
  assert.equal(conditionHolds({ field: "wave", op: ">=", value: 6 }, { placement: 1 }), false, "campo ausente não casa");
});

test("condição sobre campo que o evento não tem é recusada na validação, com o caminho", () => {
  const result = validateBundle(rawExample((s) => { s.missions.pool[0].where = [{ field: "stars", op: ">=", value: 2 }]; }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.path === "sections.missions.pool[0].where[0].field"));
});

test("troca paga no catálogo é recusada", () => {
  const result = validateBundle(rawExample((s) => { s.missions.daily.paidReroll = { price: 10 }; }));
  assert.ok(result.errors.some((error) => error.path === "sections.missions.daily.paidReroll" && /troca de missão paga é recusada/.test(error.message)));
});
