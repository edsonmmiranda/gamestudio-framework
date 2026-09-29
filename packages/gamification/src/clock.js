// Relógios: tempo injetável, virada do dia em hora UTC configurável, semana,
// mês e temporada com início e fim.
//
// Nada aqui lê `Date.now()` sozinho: o relógio entra por parâmetro. O teste usa um
// relógio manual, o simulador acelera o mesmo relógio, e o jogo usa o do sistema.
// A chave de um período é um número (dia, semana) ou texto (mês, temporada); mudou a
// chave, o relógio virou, e o motor aplica o que ele declara reiniciar e expirar.

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

// Peças de estado que um relógio pode reiniciar, acumular ou fazer expirar.
// Vocabulário fechado: um relógio que cita outra coisa é recusado na validação.
export const SLOTS = Object.freeze({
  "missions.daily": "missões do dia",
  "rerolls.daily": "troca grátis do dia",
  "caps.daily": "tetos do dia (XP e moeda de partida)",
  "consolation.daily": "consolos do dia",
  "missions.weekly": "missões da semana",
  "missions.season": "missões da temporada",
  "pass.progress": "XP e tiers do passe",
  "pass.premium": "trilha premium liberada",
  "offers.purchases": "compras de oferta",
  "trail.points": "pontos da trilha",
  "streak.losses": "derrotas seguidas",
  collection: "coleção (visuais e retratos)",
  wallet: "carteira (moedas que não vencem)",
});

// A coleção e a carteira nunca zeram: tirar do jogador o que ele ganhou não é relógio,
// é confisco. Moeda que vence declara isso na própria moeda (`expiresWith`).
export const NEVER_RESET = Object.freeze(["collection", "wallet"]);

export const PERIODS = Object.freeze(["daily", "weekly", "season"]);

export function manualClock(start = 0) {
  let now = typeof start === "string" ? Date.parse(start) : start;
  return {
    now: () => now,
    set(value) {
      now = typeof value === "string" ? Date.parse(value) : value;
      return now;
    },
    advance(ms) {
      now += ms;
      return now;
    },
  };
}

export function systemClock() {
  return { now: () => Date.now() };
}

// Dia de jogo: começa na hora de virada (UTC). O dia 0 começou em 1970-01-01, na virada.
export function dayKey(ms, { resetHourUtc = 0 } = {}) {
  return Math.floor((ms - resetHourUtc * HOUR_MS) / DAY_MS);
}

export function dayStart(key, { resetHourUtc = 0 } = {}) {
  return key * DAY_MS + resetHourUtc * HOUR_MS;
}

export function nextDailyReset(ms, config = {}) {
  return dayStart(dayKey(ms, config) + 1, config);
}

// Dia da semana (0 = domingo) do dia de jogo: 1970-01-01 foi quinta-feira.
export function weekday(key) {
  return (((key + 4) % 7) + 7) % 7;
}

// A semana vira no dia `weekStartsOn` (0 = domingo, 1 = segunda), na hora de virada.
export function weekKey(ms, { resetHourUtc = 0, weekStartsOn = 1 } = {}) {
  const day = dayKey(ms, { resetHourUtc });
  return Math.floor((day + 4 - weekStartsOn) / 7);
}

// Mês civil em UTC, deslocado pela hora de virada: o gasto do mês fecha junto do dia.
export function monthKey(ms, { resetHourUtc = 0 } = {}) {
  const date = new Date(ms - resetHourUtc * HOUR_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function seasonStatus(ms, season) {
  const start = Date.parse(season.validFrom);
  const end = Date.parse(season.validTo);
  const days = Math.round((end - start) / DAY_MS);
  if (ms < start) {
    return { phase: "before", day: 0, days, daysLeft: days, warning: false, startsIn: start - ms, start, end };
  }
  if (ms >= end) {
    return { phase: "ended", day: days, days, daysLeft: 0, warning: false, start, end };
  }
  const day = Math.floor((ms - start) / DAY_MS) + 1;
  const daysLeft = Math.ceil((end - ms) / DAY_MS);
  const warning = daysLeft <= (season.endWarningDays ?? 0);
  return { phase: "active", day, days, daysLeft, warning, start, end };
}

// Chave de temporada: muda quando a temporada abre e quando fecha.
export function seasonKey(ms, season) {
  const { phase } = seasonStatus(ms, season);
  if (phase === "active") return season.id;
  if (phase === "ended") return `${season.id}:fim`;
  return `${season.id}:antes`;
}

export function periodKey(period, ms, clocks, season) {
  if (period === "daily") return dayKey(ms, clocks);
  if (period === "weekly") return weekKey(ms, clocks);
  if (period === "season") return seasonKey(ms, season);
  throw new Error(`período desconhecido: ${period}`);
}
