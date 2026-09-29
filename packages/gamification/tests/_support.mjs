// Apoio dos testes: catálogo de exemplo, motor com relógio manual e fábrica de eventos.

import { readFileSync } from "node:fs";
import { loadBundle } from "../src/catalog.js";
import { HOUR_MS, manualClock } from "../src/clock.js";
import { createGamification } from "../src/engine.js";
import { formatError } from "../src/schema.js";

export const SEASON_START = Date.parse("2026-10-01T09:00:00Z");
export const SEASON_END = Date.parse("2026-11-26T09:00:00Z");

export function readExample(name = "temporada-exemplo.json") {
  return JSON.parse(readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8"));
}

// Catálogo de exemplo, opcionalmente alterado. Sem hash declarado: a alteração é do teste.
export function rawExample(mutate) {
  const raw = readExample();
  delete raw.hash;
  mutate?.(raw.sections, raw);
  return raw;
}

export function bundle(mutate) {
  const loaded = loadBundle(rawExample(mutate));
  if (!loaded.ok) throw new Error(loaded.errors.map(formatError).join("\n"));
  return loaded.bundle;
}

export function game({ mutate, at = SEASON_START + 3 * HOUR_MS, profile, adapter, playerId = "teste" } = {}) {
  const b = bundle(mutate);
  const clock = manualClock(at);
  const g = createGamification({ bundle: b, clock, playerId, ...(adapter ? { purchaseAdapter: adapter } : {}) });
  if (profile) g.setProfile(profile);
  return { g, clock, bundle: b };
}

let counter = 0;
export const match = (over = {}) => ({
  id: `m${(counter += 1)}`,
  type: "match.finished",
  game: "batalha",
  players: 10,
  placement: 5,
  kills: 2,
  durationS: 200,
  ...over,
});
export const levelWon = (over = {}) => ({ id: `l${(counter += 1)}`, type: "level.won", game: "fases", stars: 3, durationS: 120, ...over });

export const ADULT = Object.freeze({ age: 30, ageSource: "verified", childAccount: false, guardianLinked: false });

// Adaptador de teste que venderia, com contador: prova que a segurança age antes dele.
export function stubAdapter() {
  const calls = [];
  return {
    calls,
    adapter: {
      id: "stub",
      enabled: true,
      purchase: (request) => {
        calls.push(request);
        return { ok: true, receipt: `r${calls.length}` };
      },
    },
  };
}

export const sum = (list) => list.reduce((total, value) => total + value, 0);
