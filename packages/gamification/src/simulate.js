// Simulador de economia: persona × catálogo × dias da temporada.
//
// Joga a temporada inteira pela API pública do motor, com o catálogo real e sem
// recurso injetado, e mede: dias para fechar o passe grátis e o premium (com moeda
// ganha), saldo final e inflação (fonte/sumidouro), cosméticos da temporada obtíveis
// sem pagar e o efeito dos tetos diários. Critérios configuráveis; um catálogo
// quebrado (fonte sem sumidouro, passe impossível) precisa falhar — é o controle
// negativo da receita de mecânicas do core.

import { loadBundle } from "./catalog.js";
import { dayKey, dayStart, DAY_MS, HOUR_MS, manualClock, weekday } from "./clock.js";
import { createGamification } from "./engine.js";
import { totalXp } from "./pass.js";
import { hashSeed, mulberry32, pickWeighted, shuffled } from "./rng.js";

export const SIMULATION_FORMAT = "alanstudio.gamification.simulation/1";

// Colocação por décimo do resultado (1º décimo = melhor 10%). Estrelas: peso de 1, 2 e 3.
export const DEFAULT_PERSONAS = Object.freeze([
  {
    id: "casual",
    name: "Casual",
    sessionsPerDay: 1,
    matchesPerSession: 3,
    activeDaysPerWeek: 4,
    games: 2,
    placement: [8, 9, 10, 10, 11, 11, 11, 10, 10, 10],
    levelWinRate: 0.55,
    stars: [3, 4, 3],
    soloWinRate: 0.3,
    spend: { premium: true, store: true, offers: true, reroll: true },
  },
  {
    id: "regular",
    name: "Regular",
    sessionsPerDay: 2,
    matchesPerSession: 3,
    activeDaysPerWeek: 5,
    games: 3,
    placement: [11, 11, 11, 11, 10, 10, 10, 9, 9, 8],
    levelWinRate: 0.65,
    stars: [2, 4, 4],
    soloWinRate: 0.4,
    spend: { premium: true, store: true, offers: true, reroll: true },
  },
  {
    id: "dedicado",
    name: "Dedicado",
    sessionsPerDay: 3,
    matchesPerSession: 4,
    activeDaysPerWeek: 7,
    games: 6,
    placement: [14, 13, 12, 11, 10, 10, 9, 8, 7, 6],
    levelWinRate: 0.75,
    stars: [1, 3, 6],
    soloWinRate: 0.5,
    spend: { premium: true, store: true, offers: true, reroll: true },
  },
]);

export const DEFAULT_CRITERIA = Object.freeze({
  casualFreeMaxFraction: 0.8,
  casualPersona: "casual",
  premiumClosers: ["regular", "dedicado"],
  maxInflation: 2.5,
  minObtainableWithoutPaying: 1,
});

// Horas das sessões depois da virada do dia (11h depois das 09h UTC = 17h em Brasília).
export const SESSION_OFFSETS_H = Object.freeze([11, 13, 15, 16.5]);
const MATCH_GAP_MS = 6 * 60 * 1000;

// Jogos que a persona joga: os `games` primeiros de uma ordem fixa por persona.
export function personaGames(persona, sections) {
  const games = sections.series.games;
  const order = shuffled(mulberry32(hashSeed("games", persona.id)), games.map((game) => game.id));
  return order.slice(0, Math.max(1, Math.min(persona.games ?? games.length, games.length)));
}

// Dias ativos da semana: `activeDaysPerWeek` dias sorteados por semana, estáveis por semente.
export function isActiveDay(persona, day, seed = 0) {
  const n = persona.activeDaysPerWeek ?? 7;
  if (n >= 7) return true;
  const week = Math.floor(day / 7);
  const picks = shuffled(mulberry32(hashSeed("dias", persona.id, week, seed)), [0, 1, 2, 3, 4, 5, 6]).slice(0, n);
  return picks.includes(day % 7);
}

export function makeEvent(persona, game, rng, id) {
  if (game.event === "level.won") {
    if (rng() < (persona.levelWinRate ?? 0.5)) {
      return { id, type: "level.won", game: game.id, stars: 1 + pickWeighted(rng, persona.stars ?? [1, 1, 1]), durationS: 90 + Math.floor(rng() * 90) };
    }
    return { id, type: "level.lost", game: game.id, durationS: 60 + Math.floor(rng() * 60) };
  }
  const players = game.players ?? 10;
  if (players === 1) {
    const won = rng() < (persona.soloWinRate ?? 0.3);
    const wave = 2 + Math.floor(rng() * 7) + (won ? 4 : 0);
    return { id, type: "match.finished", game: game.id, players: 1, placement: 1, won, wave, kills: wave * 3, durationS: 240 + Math.floor(rng() * 180) };
  }
  const decile = pickWeighted(rng, persona.placement ?? Array(10).fill(1));
  const placement = Math.min(players, Math.floor(((decile + rng()) / 10) * players) + 1);
  const kills = Math.max(0, Math.round(((players - placement + 1) / players) * 6 * rng() * 1.4));
  return { id, type: "match.finished", game: game.id, players, placement, kills, durationS: 150 + Math.floor(rng() * 150) };
}

// Eventos de uma sessão: jogo escolhido por peso (o preferido pesa mais).
export function sessionEvents(persona, sections, day, session, rng) {
  const ids = personaGames(persona, sections);
  const games = ids.map((id) => sections.series.games.find((game) => game.id === id));
  const weights = games.map((_, i) => games.length - i);
  const events = [];
  for (let m = 0; m < (persona.matchesPerSession ?? 3); m += 1) {
    const game = games[pickWeighted(rng, weights)];
    events.push(makeEvent(persona, game, rng, `${persona.id}:d${day}:s${session}:m${m}`));
  }
  return events;
}

// Política de gasto da persona depois de cada sessão.
export function spendPolicy(engine, persona) {
  const policy = persona.spend ?? {};
  const view = engine.view();
  const price = view.pass.price;
  if (policy.premium && !view.pass.premium && view.season.phase === "active" && engine.balance(price.currency) >= price.amount) {
    engine.unlockPremium();
  }
  if (policy.offers) {
    for (const offer of view.offers) {
      if (offer.window === "active" && offer.bought < offer.limit && engine.balance(offer.price.currency) >= offer.price.amount) engine.buyOffer(offer.id);
    }
  }
  if (policy.store) {
    const fresh = engine.view();
    const reserve = policy.premium && !fresh.pass.premium && fresh.season.phase === "active" && price.currency === fresh.store.currency ? price.amount : 0;
    const shelf = [...fresh.store.today, ...fresh.store.vault].filter((row) => !row.owned).sort((a, b) => a.price.amount - b.price.amount);
    for (const row of shelf) {
      if (engine.balance(row.price.currency) - reserve >= row.price.amount) engine.buy(row.cosmetic.id);
    }
  }
}

export function rerollForeign(engine, persona, sections) {
  if (!persona.spend?.reroll) return;
  const mine = new Set(personaGames(persona, sections));
  const view = engine.view();
  if (view.missions.rerollsLeft <= 0) return;
  const index = view.missions.daily.findIndex((slot) => !slot.done && slot.game && !mine.has(slot.game));
  if (index >= 0) engine.reroll(index);
}

// Origens e sumidouros declarados no catálogo, por moeda (análise estática).
export function analyzeCatalog(sections) {
  const currencies = Object.fromEntries(sections.currencies.map((currency) => [currency.id, { sources: new Set(), sinks: new Set() }]));
  const source = (id, label) => currencies[id]?.sources.add(label);
  const sink = (id, label) => currencies[id]?.sinks.add(label);
  const scan = (rewards, label) => (rewards ?? []).forEach((reward) => reward.currency && source(reward.currency, label));
  if (sections.rewards.match || sections.rewards.level) source(sections.rewards.currency, "partida");
  sections.pass.tiers.forEach((tier) => { scan(tier.free, "passe grátis"); scan(tier.premium, "passe premium"); });
  sections.missions.pool.forEach((mission) => scan(mission.reward, "missão"));
  (sections.firstTime ?? []).forEach((first) => scan(first.reward, "primeira vez"));
  scan(sections.dampers?.consolation?.reward, "consolo");
  (sections.offers ?? []).forEach((offer) => { scan(offer.grants, "oferta"); sink(offer.price.currency, "oferta"); });
  sections.cosmetics.forEach((cosmetic) => scan(cosmetic.duplicate, "duplicata"));
  if (sections.store.rotation.pool.length) sink(sections.store.currency, "loja");
  if (sections.store.vault?.pool?.length) sink(sections.store.currency, "cofre");
  sink(sections.pass.premium.price.currency, "passe premium");
  if (sections.luck?.enabled) {
    sections.luck.tables.forEach((table) => {
      sink(table.currency, "sorte");
      table.odds.forEach((odd) => odd.currency && source(odd.currency, "sorte"));
    });
  }
  const result = {};
  for (const [id, row] of Object.entries(currencies)) result[id] = { sources: [...row.sources].sort(), sinks: [...row.sinks].sort() };
  return result;
}

// Teto de XP que a temporada pode dar, somando tudo que existe (cota superior).
export function passXpUpperBound(sections) {
  const days = Math.round((Date.parse(sections.season.validTo) - Date.parse(sections.season.validFrom)) / DAY_MS);
  const weeks = Math.ceil(days / 7);
  const xpOf = (rewards) => (rewards ?? []).reduce((sum, reward) => sum + (reward.passXp ?? 0) + (reward.passTokens ?? 0) * (sections.pass.tokens?.xpPerToken ?? 0), 0);
  const best = (cycle, slots) => sections.missions.pool
    .filter((mission) => mission.cycle === cycle)
    .map((mission) => xpOf(mission.reward))
    .sort((a, b) => b - a)
    .slice(0, slots)
    .reduce((sum, xp) => sum + xp, 0);
  const matchCap = sections.pass.xp.dailyCap;
  if (matchCap === null || matchCap === undefined) return { days, bound: Infinity };
  const bound = days * matchCap
    + days * best("daily", sections.missions.daily.slots)
    + weeks * best("weekly", sections.missions.weekly?.slots ?? 0)
    + best("season", Infinity)
    + (sections.firstTime ?? []).reduce((sum, first) => sum + xpOf(first.reward), 0)
    + days * (sections.dampers?.consolation?.perDay ?? 0) * xpOf(sections.dampers?.consolation?.reward)
    + (sections.offers ?? []).reduce((sum, offer) => sum + offer.limit * xpOf(offer.grants), 0);
  return { days, bound };
}

// Cosméticos da temporada e quais têm caminho sem dinheiro real.
export function cosmeticPaths(sections) {
  const currency = new Map(sections.currencies.map((c) => [c.id, c]));
  const earned = (id) => Boolean(currency.get(id)?.earned) && !currency.get(id)?.purchasable;
  const paths = new Map();
  const add = (item, path, free) => {
    if (!item) return;
    const row = paths.get(item) ?? { paths: [], free: false };
    row.paths.push(path);
    row.free ||= free;
    paths.set(item, row);
  };
  const premiumFree = earned(sections.pass.premium.price.currency);
  sections.pass.tiers.forEach((tier, i) => {
    tier.free.forEach((reward) => add(reward.item, `passe grátis ${i + 1}`, true));
    tier.premium.forEach((reward) => add(reward.item, `passe premium ${i + 1}`, premiumFree));
  });
  sections.missions.pool.forEach((mission) => mission.reward.forEach((reward) => add(reward.item, `missão ${mission.id}`, true)));
  (sections.firstTime ?? []).forEach((first) => first.reward.forEach((reward) => add(reward.item, `primeira vez ${first.id}`, true)));
  const storeFree = earned(sections.store.currency);
  sections.store.rotation.pool.forEach((item) => add(item, "loja", storeFree));
  (sections.store.vault?.pool ?? []).forEach((item) => add(item, "cofre", storeFree));
  (sections.offers ?? []).forEach((offer) => offer.grants.forEach((reward) => add(reward.item, `oferta ${offer.id}`, earned(offer.price.currency))));
  (sections.store.starter ?? []).forEach((item) => add(item, "início", true));
  if (sections.luck?.enabled) {
    sections.luck.tables.forEach((table) => table.odds.forEach((odd) => add(odd.item, `sorte ${table.id}`, earned(table.currency))));
  }
  const seasonal = sections.cosmetics.filter((cosmetic) => cosmetic.season === sections.season.id);
  const free = seasonal.filter((cosmetic) => paths.get(cosmetic.id)?.free);
  return {
    seasonal: seasonal.map((cosmetic) => ({ id: cosmetic.id, paths: paths.get(cosmetic.id)?.paths ?? [], free: Boolean(paths.get(cosmetic.id)?.free) })),
    total: seasonal.length,
    obtainableWithoutPaying: free.length,
    share: seasonal.length ? free.length / seasonal.length : 1,
  };
}

// Uma persona pela temporada inteira.
export function runPersona(bundle, persona, { seed = 1, series = true } = {}) {
  const S = bundle.sections;
  const cfg = { resetHourUtc: S.clocks.resetHourUtc };
  const start = Date.parse(S.season.validFrom);
  const end = Date.parse(S.season.validTo);
  const firstDay = dayKey(start, cfg);
  const days = Math.round((end - start) / DAY_MS);
  const clock = manualClock(start);
  const engine = createGamification({ bundle, clock, playerId: `sim:${persona.id}` });
  const tiers = S.pass.tiers.length;
  const purchasable = new Set([...S.store.rotation.pool, ...(S.store.vault?.pool ?? [])]);
  const out = {
    id: persona.id,
    name: persona.name ?? persona.id,
    seed,
    seasonDays: days,
    activeDays: 0,
    events: 0,
    freeClosedDay: null,
    premiumUnlockedDay: null,
    premiumClosedDay: null,
    saturationDay: null,
    capLost: { passXp: 0, currency: {} },
    series: [],
  };
  for (let d = 0; d < days; d += 1) {
    const base = dayStart(firstDay + d, cfg);
    const rng = mulberry32(hashSeed("sim", persona.id, seed, d));
    clock.set(base + 60_000);
    engine.tick();
    const active = isActiveDay(persona, d, seed);
    if (active) {
      out.activeDays += 1;
      rerollForeign(engine, persona, S);
      for (let s = 0; s < (persona.sessionsPerDay ?? 1); s += 1) {
        clock.set(base + SESSION_OFFSETS_H[s % SESSION_OFFSETS_H.length] * HOUR_MS);
        for (const event of sessionEvents(persona, S, d, s, rng)) {
          engine.handle(event);
          out.events += 1;
          clock.advance(MATCH_GAP_MS);
        }
        spendPolicy(engine, persona);
      }
    }
    clock.set(base + DAY_MS - 60_000);
    const view = engine.view();
    out.capLost.passXp += view.pass.xpLostToday;
    for (const row of view.wallet) out.capLost.currency[row.id] = (out.capLost.currency[row.id] ?? 0) + row.lostToday;
    const tier = view.pass.progress.tier;
    const dayNumber = d + 1;
    if (out.freeClosedDay === null && tier >= tiers) out.freeClosedDay = dayNumber;
    if (out.premiumUnlockedDay === null && view.pass.premium) out.premiumUnlockedDay = dayNumber;
    if (out.premiumClosedDay === null && view.pass.premium && tier >= tiers) out.premiumClosedDay = dayNumber;
    if (out.saturationDay === null && [...purchasable].every((item) => engine.owns(item))) out.saturationDay = dayNumber;
    if (series) {
      out.series.push({
        day: dayNumber,
        active,
        tier,
        xp: view.pass.xp,
        premium: view.pass.premium,
        balances: Object.fromEntries(view.wallet.map((row) => [row.id, row.balance])),
      });
    }
  }
  clock.set(end + 60_000);
  engine.tick();
  const totals = engine.totals();
  out.finalTier = out.series.at(-1)?.tier ?? engine.view().history.at(-1)?.tier ?? 0;
  out.currencies = {};
  for (const currency of S.currencies) {
    const row = totals.currencies[currency.id] ?? { sourced: 0, spent: 0, expired: 0, balance: 0, bySource: {}, bySink: {} };
    out.currencies[currency.id] = {
      sourced: row.sourced,
      spent: row.spent,
      expired: row.expired,
      final: row.balance,
      inflation: row.spent > 0 ? Number((row.sourced / row.spent).toFixed(3)) : null,
      bySource: row.bySource,
      bySink: row.bySink,
    };
  }
  const seasonal = S.cosmetics.filter((cosmetic) => cosmetic.season === S.season.id);
  const owned = seasonal.filter((cosmetic) => engine.owns(cosmetic.id)).length;
  out.cosmetics = { seasonTotal: seasonal.length, obtained: owned, obtainedShare: seasonal.length ? Number((owned / seasonal.length).toFixed(3)) : 1 };
  out.freeClosedFraction = out.freeClosedDay === null ? null : Number((out.freeClosedDay / days).toFixed(3));
  out.premiumClosedFraction = out.premiumClosedDay === null ? null : Number((out.premiumClosedDay / days).toFixed(3));
  if (!series) delete out.series;
  return out;
}

function uncappedOverrides(sections) {
  return {
    pass: { ...sections.pass, xp: { ...sections.pass.xp, dailyCap: null } },
    currencies: sections.currencies.map((currency) => ({ ...currency, dailyCap: null })),
  };
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};
// Pior caso entre as sementes: um dia que não chega (null) vence qualquer número.
const worstDay = (values) => (values.includes(null) ? null : Math.max(...values));
const medianDay = (values) => {
  const reached = values.filter((value) => value !== null);
  return reached.length * 2 > values.length ? median(reached) : null;
};

// A mesma persona em várias sementes: o critério julga o pior caso, não a sorte de uma.
export function runPersonaSeeds(bundle, persona, seeds, { series = true } = {}) {
  const runs = seeds.map((seed, i) => runPersona(bundle, persona, { seed, series: series && i === 0 }));
  const first = runs[0];
  const days = (key) => runs.map((run) => run[key]);
  const result = {
    ...first,
    seeds,
    activeDays: median(days("activeDays")),
    events: median(days("events")),
    freeClosedDay: worstDay(days("freeClosedDay")),
    freeClosedDayMedian: medianDay(days("freeClosedDay")),
    premiumUnlockedDay: worstDay(days("premiumUnlockedDay")),
    premiumClosedDay: worstDay(days("premiumClosedDay")),
    premiumClosedDayMedian: medianDay(days("premiumClosedDay")),
    saturationDay: medianDay(days("saturationDay")),
    bySeed: runs.map((run) => ({
      seed: run.seed,
      freeClosedDay: run.freeClosedDay,
      premiumClosedDay: run.premiumClosedDay,
      inflation: Object.fromEntries(Object.entries(run.currencies).map(([id, row]) => [id, row.inflation])),
    })),
  };
  result.currencies = {};
  for (const id of Object.keys(first.currencies)) {
    const rows = runs.map((run) => run.currencies[id]);
    const inflations = rows.map((row) => row.inflation);
    const worst = rows.reduce((a, b) => ((b.inflation ?? Infinity) > (a.inflation ?? Infinity) ? b : a));
    result.currencies[id] = {
      ...worst,
      sourcedMedian: median(rows.map((row) => row.sourced)),
      spentMedian: median(rows.map((row) => row.spent)),
      finalMedian: median(rows.map((row) => row.final)),
      inflation: inflations.includes(null) ? null : Math.max(...inflations),
      inflationMedian: inflations.includes(null) ? null : median(inflations),
      neverSpent: rows.some((row) => row.sourced > 0 && row.spent === 0),
    };
  }
  result.cosmetics = { ...first.cosmetics, obtainedShare: Math.min(...runs.map((run) => run.cosmetics.obtainedShare)) };
  result.freeClosedFraction = result.freeClosedDay === null ? null : Number((result.freeClosedDay / result.seasonDays).toFixed(3));
  result.premiumClosedFraction = result.premiumClosedDay === null ? null : Number((result.premiumClosedDay / result.seasonDays).toFixed(3));
  return result;
}

export const DEFAULT_SEEDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);

export function simulateSeason(bundle, { personas = DEFAULT_PERSONAS, criteria = {}, seeds = DEFAULT_SEEDS, series = true } = {}) {
  const S = bundle.sections;
  const rules = { ...DEFAULT_CRITERIA, ...criteria };
  const uncapped = loadBundle({ format: bundle.format, id: bundle.id, version: bundle.version, sections: S }, { overrides: uncappedOverrides(S) });
  const results = personas.map((persona) => {
    const result = runPersonaSeeds(bundle, persona, seeds, { series });
    if (uncapped.ok) {
      const free = runPersona(uncapped.bundle, persona, { seed: seeds[0], series: false });
      const capped = runPersona(bundle, persona, { seed: seeds[0], series: false });
      result.capEffect = {
        seed: seeds[0],
        passXpLost: capped.capLost.passXp,
        currencyLost: capped.capLost.currency,
        freeClosedDay: { withCaps: capped.freeClosedDay, withoutCaps: free.freeClosedDay },
        premiumClosedDay: { withCaps: capped.premiumClosedDay, withoutCaps: free.premiumClosedDay },
        sourced: { withCaps: Object.fromEntries(Object.entries(capped.currencies).map(([id, row]) => [id, row.sourced])), withoutCaps: Object.fromEntries(Object.entries(free.currencies).map(([id, row]) => [id, row.sourced])) },
      };
    }
    delete result.capLost;
    return result;
  });

  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });
  const flow = analyzeCatalog(S);
  for (const [id, row] of Object.entries(flow)) {
    if (row.sources.length === 0) continue;
    check(`sumidouro:${id}`, row.sinks.length > 0, row.sinks.length ? `${id}: entra por ${row.sources.join(", ")}; sai por ${row.sinks.join(", ")}` : `${id} entra por ${row.sources.join(", ")} e não tem sumidouro: cresce sem parar`);
  }
  const reach = passXpUpperBound(S);
  const needed = totalXp(S.pass);
  check("passe_possivel", reach.bound >= needed, `o passe pede ${needed} XP; a temporada dá no máximo ${reach.bound === Infinity ? "sem teto" : reach.bound}`);

  const byId = new Map(results.map((result) => [result.id, result]));
  const casual = byId.get(rules.casualPersona);
  if (casual) {
    const limit = Math.floor(rules.casualFreeMaxFraction * casual.seasonDays);
    check("casual_fecha_gratis", casual.freeClosedDay !== null && casual.freeClosedDay <= limit,
      casual.freeClosedDay === null ? `${casual.name} não fecha o passe grátis na temporada em pelo menos uma semente` : `${casual.name} fecha o grátis até o dia ${casual.freeClosedDay} de ${casual.seasonDays} no pior caso (mediana ${casual.freeClosedDayMedian}; limite ${limit})`);
  }
  for (const id of rules.premiumClosers) {
    const persona = byId.get(id);
    if (!persona) continue;
    check(`premium_com_moeda_ganha:${id}`, persona.premiumClosedDay !== null,
      persona.premiumClosedDay === null ? `${persona.name} não fecha o premium com moeda ganha em pelo menos uma semente` : `${persona.name} fecha o premium com moeda ganha até o dia ${persona.premiumClosedDay} no pior caso`);
  }
  for (const persona of results) {
    for (const [currency, row] of Object.entries(persona.currencies)) {
      if (row.sourced === 0 && !row.neverSpent) continue;
      if (row.neverSpent) {
        check(`moeda_parada:${persona.id}:${currency}`, false, `${persona.name} ganha ${currency} e não gasta nada em pelo menos uma semente: a moeda cresce sem sumidouro`);
        continue;
      }
      check(`inflacao:${persona.id}:${currency}`, row.inflation <= rules.maxInflation, `${persona.name}: ${currency} entra ${row.sourced}, sai ${row.spent} no pior caso (fonte/sumidouro ${row.inflation}, mediana ${row.inflationMedian}; limite ${rules.maxInflation})`);
    }
  }
  const cosmetics = cosmeticPaths(S);
  check("cosmeticos_sem_pagar", cosmetics.share >= rules.minObtainableWithoutPaying, `${cosmetics.obtainableWithoutPaying} de ${cosmetics.total} cosméticos da temporada têm caminho sem dinheiro real`);

  return {
    format: SIMULATION_FORMAT,
    catalog: { id: bundle.id, version: bundle.version, hash: bundle.hash },
    season: { id: S.season.id, days: reach.days, validFrom: S.season.validFrom, validTo: S.season.validTo },
    seeds,
    criteria: rules,
    pass: checks.every((item) => item.ok),
    checks,
    static: { currencies: flow, passXp: { total: needed, upperBound: reach.bound === Infinity ? null : reach.bound }, cosmetics },
    personas: results,
  };
}

// Resumo curto para terminal e relatório.
export function summarize(report) {
  return {
    catalog: report.catalog,
    pass: report.pass,
    failed: report.checks.filter((item) => !item.ok).map((item) => item.detail),
    seeds: report.seeds,
    personas: report.personas.map((persona) => ({
      id: persona.id,
      seasonDays: persona.seasonDays,
      freeClosedDay: { worst: persona.freeClosedDay, median: persona.freeClosedDayMedian },
      premiumClosedDay: { worst: persona.premiumClosedDay, median: persona.premiumClosedDayMedian },
      premiumUnlockedDay: persona.premiumUnlockedDay,
      inflation: Object.fromEntries(Object.entries(persona.currencies).map(([id, row]) => [id, { worst: row.inflation, median: row.inflationMedian }])),
      finalMedian: Object.fromEntries(Object.entries(persona.currencies).map(([id, row]) => [id, row.finalMedian])),
      cosmetics: persona.cosmetics.obtainedShare,
      capEffect: persona.capEffect ? { passXpLost: persona.capEffect.passXpLost, currencyLost: persona.capEffect.currencyLost, freeClosedDay: persona.capEffect.freeClosedDay } : null,
    })),
  };
}

export { weekday };
