// Passe da temporada: curva de XP por tier, XP por partida com teto e sem pagar
// partida parada, token limitado ao que falta.
//
// Padrões: a XP do passe tem punição abaixo de um limiar; o token do passe de evento é
// limitado ao que falta para fechar. O que não entra: cauda paga depois do último tier
// — o XP que sobra depois do fim simplesmente não vira nada.

export function thresholds(pass) {
  const list = [];
  let total = 0;
  for (const tier of pass.tiers) {
    total += tier.xp;
    list.push(total);
  }
  return list;
}

export function totalXp(pass) {
  return pass.tiers.reduce((sum, tier) => sum + tier.xp, 0);
}

// Quantos tiers o XP alcança (0 até o número de tiers; nunca além do último).
export function tierFor(pass, xp) {
  const marks = thresholds(pass);
  let tier = 0;
  while (tier < marks.length && xp >= marks[tier]) tier += 1;
  return tier;
}

export function progressFor(pass, xp) {
  const marks = thresholds(pass);
  const tier = tierFor(pass, xp);
  if (tier >= marks.length) return { tier, tiers: marks.length, into: 0, needed: 0, done: true };
  const start = tier === 0 ? 0 : marks[tier - 1];
  return { tier, tiers: marks.length, into: xp - start, needed: marks[tier] - start, done: false };
}

// Partida parada, curta demais ou marcada como ociosa não paga nada.
export function isIdle(pass, event) {
  if (event.idle === true) return true;
  const min = pass.xp.idle?.minDurationS ?? 0;
  return Number.isFinite(event.durationS) && event.durationS < min;
}

export function isTopHalf(event) {
  return event.players > 1 && event.placement <= event.players / 2;
}

export function isPodium(event) {
  return event.players > 2 && event.placement <= 3;
}

export function isWin(event) {
  if (event.type === "level.won") return true;
  if (event.type === "level.lost") return false;
  if (typeof event.won === "boolean") return event.won;
  return event.players > 1 && event.placement === 1;
}

// XP de uma partida, antes do teto diário.
export function eventXp(pass, event) {
  if (isIdle(pass, event)) return { xp: 0, idle: true };
  if (event.type === "match.finished") {
    const rule = pass.xp.match;
    let xp = rule.base;
    if (isTopHalf(event)) xp += rule.topHalf ?? 0;
    if (isPodium(event)) xp += rule.podium ?? 0;
    if (isWin(event)) xp += rule.win ?? 0;
    return { xp: Math.min(xp, rule.cap), idle: false };
  }
  if (event.type === "level.won") {
    const rule = pass.xp.level;
    return { xp: Math.min(rule.base + (rule.perStar ?? 0) * (event.stars ?? 0), rule.cap), idle: false };
  }
  if (event.type === "level.lost") {
    const rule = pass.xp.level;
    return { xp: Math.min(Math.floor(rule.base / 2), rule.cap), idle: false };
  }
  return { xp: 0, idle: false };
}

// Quanto do XP oferecido cabe: nunca passa do último tier.
export function clampXp(pass, currentXp, offered) {
  return Math.max(0, Math.min(offered, totalXp(pass) - currentXp));
}

// Tokens que ainda servem: o que falta para fechar, arredondado para cima.
export function tokensAllowed(pass, currentXp, offered) {
  const per = pass.tokens?.xpPerToken;
  if (!per) return 0;
  const missing = Math.max(0, totalXp(pass) - currentXp);
  return Math.max(0, Math.min(offered, Math.ceil(missing / per)));
}
