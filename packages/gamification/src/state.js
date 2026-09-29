// Estado do jogador: versionado, restaurável e com o livro-razão como verdade.
//
// Segue a receita de persistência do core: saldo não se salva (é a soma do livro),
// estado de versão futura bloqueia a gravação em vez de ser sobrescrito, e um
// lançamento ilegível é separado e relatado, não aceito calado.

import { createLedger } from "./ledger.js";
import { defaultProfile } from "./safety.js";

export const STATE_SCHEMA = 1;

export function defaultState(playerId = "jogador", bundleId = null) {
  return {
    schema: STATE_SCHEMA,
    playerId,
    bundleId,
    profile: defaultProfile(),
    ledger: [],
    clocks: {},
    pass: { season: null, xp: 0, premium: false, granted: { free: 0, premium: 0 } },
    missions: {
      daily: { key: null, list: [], rerolls: 0 },
      weekly: { key: null, list: [] },
      season: { key: null, list: [] },
    },
    caps: { passXp: 0, passXpLost: 0, currency: {}, currencyLost: {} },
    dampers: { lossStreak: 0, consolations: 0 },
    trail: { points: 0 },
    offers: {},
    luck: { pity: {}, pulls: {} },
    firstTime: {},
    equipped: { portrait: null, visuals: {} },
    seenEvents: [],
    funnel: { tiers: {} },
    spend: {},
    games: {},
    history: [],
  };
}

export function serialize(state) {
  return JSON.stringify(state);
}

// Restaura um estado salvo. `status`: absent, ok, recovered ou blocked.
export function restore(raw, { playerId = "jogador", bundleId = null } = {}) {
  if (raw === null || raw === undefined || raw === "") {
    return { status: "absent", state: defaultState(playerId, bundleId), notes: [] };
  }
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { status: "recovered", state: defaultState(playerId, bundleId), notes: ["estado ilegível; começou do zero sem apagar o original"], broken: raw };
    }
  }
  if (!data || typeof data !== "object") {
    return { status: "recovered", state: defaultState(playerId, bundleId), notes: ["estado sem forma de objeto"] };
  }
  if (Number.isInteger(data.schema) && data.schema > STATE_SCHEMA) {
    return { status: "blocked", state: defaultState(playerId, bundleId), notes: [`estado da versão ${data.schema}; gravação bloqueada para não sobrescrever`] };
  }
  const base = defaultState(data.playerId ?? playerId, data.bundleId ?? bundleId);
  const state = {
    ...base,
    ...data,
    pass: { ...base.pass, ...(data.pass ?? {}), granted: { ...base.pass.granted, ...(data.pass?.granted ?? {}) } },
    missions: { ...base.missions, ...(data.missions ?? {}) },
    caps: { ...base.caps, ...(data.caps ?? {}) },
    dampers: { ...base.dampers, ...(data.dampers ?? {}) },
    luck: { ...base.luck, ...(data.luck ?? {}) },
    equipped: { ...base.equipped, ...(data.equipped ?? {}) },
    funnel: { ...base.funnel, ...(data.funnel ?? {}) },
    profile: { ...base.profile, ...(data.profile ?? {}) },
    schema: STATE_SCHEMA,
  };
  const ledger = createLedger(Array.isArray(data.ledger) ? data.ledger : []);
  const rejected = ledger.rejected();
  state.ledger = ledger.entries();
  const notes = rejected.map((item) => `lançamento recusado ao restaurar: ${item.reason}`);
  return { status: rejected.length ? "recovered" : "ok", state, notes, rejected };
}
