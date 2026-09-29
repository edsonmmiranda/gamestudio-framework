// Missões como condição sobre evento.
//
// Muitos eventos alimentam muitas condições, e a tela de resultado atualiza vários
// tipos de tarefa de uma vez. Aqui a missão é dado:
// evento (`when`), jogo, condições (`where`), meta e recompensa. A mesma partida
// atualiza todas as missões ativas que casam, de uma vez.

import { hashSeed, mulberry32, shuffled } from "./rng.js";

const OPS = {
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
};

export function conditionHolds(condition, event) {
  const left = event[condition.field];
  if (left === undefined) return false;
  let right = condition.value;
  if (condition.ref !== undefined) {
    const base = event[condition.ref];
    if (!Number.isFinite(base)) return false;
    right = base * (condition.times ?? 1);
  }
  return OPS[condition.op](left, right);
}

export function eventMatches(def, event) {
  if (def.when !== event.type) return false;
  if (def.game !== undefined && def.game !== null && def.game !== event.game) return false;
  return (def.where ?? []).every((condition) => conditionHolds(condition, event));
}

export function goalTarget(def) {
  return def.goal.count ?? def.goal.target;
}

// Avança uma missão com um evento que já casou. Devolve o progresso novo.
export function advance(def, slot, event) {
  if (def.goal.count !== undefined) return { ...slot, progress: slot.progress + 1 };
  if (def.goal.sum !== undefined) {
    const value = Number.isFinite(event[def.goal.sum]) ? event[def.goal.sum] : 0;
    return { ...slot, progress: slot.progress + Math.max(0, value) };
  }
  if (def.goal.distinct === "game") {
    const seen = slot.seen ?? [];
    const next = seen.includes(event.game) ? seen : [...seen, event.game];
    return { ...slot, seen: next, progress: next.length };
  }
  return slot;
}

export function freshSlot(id) {
  return { id, progress: 0, done: false };
}

// Sorteio das missões do ciclo: mesma semente para todo jogador no mesmo dia.
// A semente não inclui gasto nem perfil: missão não é oferta segmentada.
export function pickMissions(pool, cycle, count, seedParts) {
  const candidates = pool.filter((mission) => mission.cycle === cycle).map((mission) => mission.id);
  if (cycle === "season") return candidates;
  const rng = mulberry32(hashSeed(...seedParts));
  return shuffled(rng, candidates).slice(0, count);
}
