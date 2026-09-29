// Amortecedores de frustração e de queda.
//
// Consolo depois de derrotas seguidas: partida contra bots, apaziguamento, consolo
// único por mundo. Proteção de queda: margem antes de cair de faixa, cartão de
// proteção, limite de queda configurável no catálogo.

import { isPodium, isTopHalf, isWin } from "./pass.js";

export function isLoss(event) {
  if (event.type === "level.won") return false;
  if (event.type === "level.lost") return true;
  if (typeof event.won === "boolean") return !event.won;
  if (event.players > 1) return event.placement > event.players / 2;
  return false;
}

export function trailTier(trail, points) {
  let tier = 0;
  while (tier + 1 < trail.thresholds.length && points >= trail.thresholds[tier + 1]) tier += 1;
  return tier;
}

export function trailDelta(trail, event) {
  const p = trail.points;
  if (isLoss(event)) return p.loss;
  let delta = p.played;
  if (isTopHalf(event)) delta += p.topHalf;
  if (isPodium(event)) delta += p.podium;
  if (isWin(event)) delta += p.win;
  return delta;
}

// Aplica um ganho ou perda à trilha, com as duas proteções: teto de perda por
// partida e margem antes de cair do tier (quem está na margem fica no piso do tier).
export function applyTrail(trail, points, delta) {
  if (delta >= 0) return { points: points + delta, protected: false };
  const { maxLossPerMatch, tierBuffer } = trail.protection;
  const loss = Math.min(-delta, maxLossPerMatch);
  const floor = trail.thresholds[trailTier(trail, points)];
  let next = points - loss;
  let protectedDrop = loss < -delta;
  if (next < floor && floor - next <= tierBuffer) {
    next = floor;
    protectedDrop = true;
  }
  return { points: Math.max(0, next), protected: protectedDrop };
}
