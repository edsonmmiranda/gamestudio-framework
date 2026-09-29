// Relógios: virada do dia na hora UTC certa (inclusive virada de mês e de ano),
// semana no dia declarado, temporada que zera só o que declara, o que vence some,
// o que acumula fica.

import { test } from "node:test";
import assert from "node:assert/strict";

import { validateBundle } from "../src/catalog.js";
import { DAY_MS, HOUR_MS, dayKey, dayStart, monthKey, nextDailyReset, seasonStatus, weekKey, weekday } from "../src/clock.js";
import { mulberry32 } from "../src/rng.js";
import { game, match, rawExample, SEASON_END, SEASON_START } from "./_support.mjs";

test("o dia vira exatamente na hora UTC configurada, também na virada de mês, de ano e em fevereiro bissexto", () => {
  const dates = [[2026, 8, 30], [2026, 9, 31], [2026, 11, 31], [2028, 1, 28], [2028, 1, 29], [2027, 0, 31]];
  for (const resetHourUtc of [0, 9, 12, 23]) {
    for (const [year, month, day] of dates) {
      const reset = Date.UTC(year, month, day, resetHourUtc);
      const cfg = { resetHourUtc };
      assert.equal(dayKey(reset, cfg), dayKey(reset - 1, cfg) + 1, `vira às ${resetHourUtc}h de ${year}-${month + 1}-${day}`);
      assert.equal(dayKey(reset - 1, cfg), dayKey(reset - DAY_MS + 1, cfg), "o resto do dia anterior é um dia só");
      assert.equal(dayStart(dayKey(reset, cfg), cfg), reset);
      assert.equal(nextDailyReset(reset - 1, cfg), reset);
    }
  }
});

test("propriedade: todo instante cai no dia que começa na última virada", () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 2000; i += 1) {
    const resetHourUtc = Math.floor(rng() * 24);
    const ms = Date.UTC(2026, 0, 1) + Math.floor(rng() * 4 * 365 * DAY_MS);
    const key = dayKey(ms, { resetHourUtc });
    const start = dayStart(key, { resetHourUtc });
    assert.ok(start <= ms && ms < start + DAY_MS);
    assert.equal(new Date(start).getUTCHours(), resetHourUtc);
  }
});

test("a semana vira no dia declarado, na hora de virada", () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 500; i += 1) {
    const weekStartsOn = Math.floor(rng() * 7);
    const cfg = { resetHourUtc: 9, weekStartsOn };
    const day = Math.floor(rng() * 5000) + 20000;
    const ms = dayStart(day, cfg);
    const changed = weekKey(ms, cfg) !== weekKey(ms - 1, cfg);
    assert.equal(changed, weekday(day) === weekStartsOn);
  }
  // 2026-10-05 é segunda-feira.
  const monday = Date.UTC(2026, 9, 5, 9);
  assert.equal(new Date(monday).getUTCDay(), 1);
  assert.notEqual(weekKey(monday, { resetHourUtc: 9, weekStartsOn: 1 }), weekKey(monday - 1, { resetHourUtc: 9, weekStartsOn: 1 }));
});

test("o mês do limite de gasto fecha junto do dia", () => {
  const cfg = { resetHourUtc: 9 };
  assert.equal(monthKey(Date.parse("2026-10-01T08:59:59Z"), cfg), "2026-09");
  assert.equal(monthKey(Date.parse("2026-10-01T09:00:00Z"), cfg), "2026-10");
  assert.equal(monthKey(Date.parse("2027-01-01T08:00:00Z"), cfg), "2026-12");
});

test("a temporada avisa o fim nos últimos dias e fecha na hora", () => {
  const season = rawExample().sections.season;
  assert.equal(seasonStatus(SEASON_START - 1, season).phase, "before");
  const open = seasonStatus(SEASON_START, season);
  assert.deepEqual([open.phase, open.day, open.days, open.warning], ["active", 1, 56, false]);
  assert.equal(seasonStatus(SEASON_END - 5 * DAY_MS, season).warning, true);
  assert.equal(seasonStatus(SEASON_END - 6 * DAY_MS, season).warning, false);
  assert.equal(seasonStatus(SEASON_END, season).phase, "ended");
});

test("a virada do dia renova missões, troca e tetos; antes da hora nada muda", () => {
  const { g, clock } = game();
  const before = g.view();
  g.reroll(0);
  for (let i = 0; i < 12; i += 1) g.handle(match({ placement: 1 }));
  assert.ok(g.view().pass.xpToday > 0);
  clock.set(dayStart(before.clock.day + 1, { resetHourUtc: 9 }) - 1);
  assert.equal(g.view().missions.rerollsLeft, 0);
  clock.advance(1);
  const after = g.view();
  assert.equal(after.missions.rerollsLeft, 1);
  assert.equal(after.pass.xpToday, 0);
  assert.ok(after.missions.daily.every((slot) => slot.progress === 0 && !slot.done));
});

test("a temporada zera só o que declara: passe zera, trilha e carteira ficam, ficha vence", () => {
  const { g, clock } = game();
  for (let i = 0; i < 20; i += 1) g.handle(match({ placement: 1, kills: 5 }));
  g.handle(match({ id: "semana", placement: 2 }));
  const mid = g.view();
  // Garante ficha em carteira: o tier 8 da trilha grátis paga fichas.
  clock.set(SEASON_START + 10 * DAY_MS);
  for (let d = 0; d < 20; d += 1) {
    clock.set(SEASON_START + (10 + d) * DAY_MS + 3 * HOUR_MS);
    for (let i = 0; i < 12; i += 1) g.handle(match({ placement: 1 }));
  }
  const late = g.view();
  const fichas = late.wallet.find((row) => row.id === "fichas").balance;
  const moedas = late.wallet.find((row) => row.id === "moedas").balance;
  assert.ok(fichas > 0, "tem ficha para vencer");
  assert.ok(late.trail.points > mid.trail.points);
  const owned = late.collection.filter((item) => item.owned).map((item) => item.id);
  clock.set(SEASON_END + HOUR_MS);
  const ended = g.view();
  assert.equal(ended.pass.xp, 0, "o passe zera (declarado em resets)");
  assert.equal(ended.pass.premium, false);
  assert.equal(ended.trail.points, late.trail.points, "a trilha acumula (não declarada em resets)");
  assert.equal(ended.wallet.find((row) => row.id === "moedas").balance, moedas, "a carteira fica");
  assert.equal(ended.wallet.find((row) => row.id === "fichas").balance, 0, "a ficha vence");
  assert.ok(g.entries().some((entry) => entry.sink === "expiry" && entry.currency === "fichas" && entry.delta === -fichas));
  assert.deepEqual(ended.collection.filter((item) => item.owned).map((item) => item.id), owned, "a coleção fica");
  assert.equal(ended.history.at(-1).season, "t1");
  assert.equal(g.handle(match()).reason, "season_inactive");
});

test("declarar a trilha no relógio da temporada faz a trilha zerar; não declarar, não", () => {
  const { g, clock } = game({ mutate: (s) => s.clocks.list[2].resets.push("trail.points") });
  for (let i = 0; i < 10; i += 1) g.handle(match({ placement: 1 }));
  assert.ok(g.view().trail.points > 0);
  clock.set(SEASON_END + HOUR_MS);
  assert.equal(g.view().trail.points, 0);
});

test("relógio que zera a coleção ou a carteira é recusado, com o campo no erro", () => {
  for (const slot of ["collection", "wallet"]) {
    const raw = rawExample((s) => s.clocks.list[2].resets.push(slot));
    const result = validateBundle(raw);
    assert.equal(result.ok, false);
    const index = raw.sections.clocks.list[2].resets.length - 1;
    assert.ok(result.errors.some((error) => error.path === `sections.clocks.list[2].resets[${index}]` && /nunca zera/.test(error.message)));
  }
});

test("moeda que vence precisa ser declarada no relógio certo", () => {
  const raw = rawExample((s) => { s.clocks.list[2].expires = []; });
  const result = validateBundle(raw);
  assert.ok(result.errors.some((error) => error.path === "sections.currencies[1].expiresWith"));
});
