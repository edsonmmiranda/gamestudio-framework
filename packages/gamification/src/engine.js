// Motor da gamificação: recebe eventos dos jogos e ações do jogador, aplica as
// regras do catálogo e grava tudo no livro-razão.
//
// Uma partida paga de uma vez moeda (com teto diário), XP de passe (com teto e sem
// pagar partida parada), todas as missões que casam, a primeira vez, o consolo e a
// trilha — um mesmo evento pode contar em várias trilhas. Os relógios viram antes de
// cada ação.

import { EVENT_FIELDS, EVENT_TYPES } from "./catalog-schema.js";
import { dayKey, monthKey, nextDailyReset, periodKey, seasonStatus, weekKey } from "./clock.js";
import { applyTrail, isLoss, trailDelta, trailTier } from "./dampers.js";
import { createLedger } from "./ledger.js";
import { displayOdds, draw } from "./luck.js";
import { advance, eventMatches, freshSlot, goalTarget, pickMissions } from "./missions.js";
import { clampXp, eventXp, isIdle, isPodium, isTopHalf, isWin, progressFor, thresholds, tokensAllowed, totalXp } from "./pass.js";
import { disabledPurchaseAdapter } from "./purchase.js";
import { hashSeed, mulberry32 } from "./rng.js";
import { ageBand, checkLuck, checkRealPurchase } from "./safety.js";
import { defaultState, STATE_SCHEMA } from "./state.js";
import { offerWindow, priceOf, rotation, vaultItems, vaultOpen } from "./store.js";
import { experiments, standardEvents } from "./telemetry.js";

const SEEN_LIMIT = 4000;
const CYCLES = ["daily", "weekly", "season"];

export function validateEvent(event, index) {
  if (!event || typeof event !== "object") return "evento precisa ser objeto";
  if (typeof event.id !== "string" || event.id.length === 0) return "id do evento obrigatório (é ele que impede pagar duas vezes)";
  if (!EVENT_TYPES.includes(event.type)) return `tipo desconhecido: ${event.type}`;
  if (!index.games.has(event.game)) return `jogo desconhecido: ${event.game}`;
  const int = (value, min) => Number.isInteger(value) && value >= min;
  if (event.type === "match.finished") {
    if (!int(event.players, 1)) return "players precisa ser inteiro ≥ 1";
    if (!int(event.placement, 1) || event.placement > event.players) return "placement precisa ficar entre 1 e players";
    if (!(Number.isFinite(event.durationS) && event.durationS >= 0)) return "durationS obrigatório";
    if (event.kills !== undefined && !int(event.kills, 0)) return "kills precisa ser inteiro ≥ 0";
    if (event.wave !== undefined && !int(event.wave, 0)) return "wave precisa ser inteiro ≥ 0";
  }
  if (event.type === "level.won" && !(int(event.stars, 0) && event.stars <= 3)) return "stars precisa ficar entre 0 e 3";
  if (event.won !== undefined && typeof event.won !== "boolean") return "won precisa ser booleano";
  if (event.idle !== undefined && typeof event.idle !== "boolean") return "idle precisa ser booleano";
  const allowed = new Set(["id", "type", "game", "at", ...EVENT_FIELDS[event.type]]);
  const extra = Object.keys(event).find((key) => !allowed.has(key));
  if (extra) return `campo fora do vocabulário do evento ${event.type}: ${extra}`;
  return null;
}

export function createGamification({ bundle, clock, state = null, playerId = "jogador", purchaseAdapter = disabledPurchaseAdapter } = {}) {
  if (!bundle?.sections || !bundle.index) throw new Error("createGamification precisa de um pacote carregado por loadBundle");
  if (!clock || typeof clock.now !== "function") throw new Error("createGamification precisa de um relógio (clock.now)");
  const S = bundle.sections;
  const index = bundle.index;
  const cfg = { resetHourUtc: S.clocks.resetHourUtc, weekStartsOn: S.clocks.weekStartsOn };

  const st = state ? structuredClone(state) : defaultState(playerId, bundle.id);
  if (st.schema !== STATE_SCHEMA) throw new Error(`estado de versão ${st.schema}; use restore() antes`);
  const ledger = createLedger(st.ledger ?? []);
  delete st.ledger;
  st.playerId ??= playerId;

  const now = () => clock.now();
  const season = () => seasonStatus(now(), S.season);
  const seasonActive = () => season().phase === "active";

  // ---------- lançamentos ----------
  function credit(currency, amount, source, txId, ref, effects) {
    if (!(amount > 0)) return null;
    const result = ledger.post({ txId, at: now(), currency, delta: amount, source, ref });
    if (result.ok && !result.duplicate) effects?.push({ type: "ledger", entry: result.entry });
    return result;
  }

  function grantItem(item, source, txId, ref, effects) {
    if (ledger.has(txId) || ledger.has(`${txId}:dup:0`)) return;
    if (ledger.owns(item)) {
      const cosmetic = index.cosmetics.get(item);
      (cosmetic?.duplicate ?? []).forEach((reward, j) => {
        credit(reward.currency, reward.amount, "duplicate", `${txId}:dup:${j}`, { item, from: source }, effects);
      });
      effects?.push({ type: "duplicate", item });
      return;
    }
    const result = ledger.post({ txId, at: now(), item, delta: 1, source, ref });
    if (result.ok && !result.duplicate) effects?.push({ type: "item", item, source });
  }

  function grantReward(reward, source, txId, ref, effects) {
    if (reward.currency !== undefined) credit(reward.currency, reward.amount, source, txId, ref, effects);
    else if (reward.item !== undefined) grantItem(reward.item, source, txId, ref, effects);
    else if (reward.passXp !== undefined) addPassXp(reward.passXp, { capped: false }, effects);
    else if (reward.passTokens !== undefined) {
      const tokens = tokensAllowed(S.pass, st.pass.xp, reward.passTokens);
      if (tokens < reward.passTokens) effects?.push({ type: "tokens_limited", offered: reward.passTokens, used: tokens });
      addPassXp(tokens * (S.pass.tokens?.xpPerToken ?? 0), { capped: false }, effects);
    }
  }

  // ---------- passe ----------
  function grantTiers(effects) {
    const tier = progressFor(S.pass, st.pass.xp).tier;
    while (st.pass.granted.free < tier) {
      st.pass.granted.free += 1;
      const t = st.pass.granted.free;
      S.pass.tiers[t - 1].free.forEach((reward, i) => grantReward(reward, "pass_free", `pass:${S.season.id}:free:${t}:${i}`, { tier: t }, effects));
      st.funnel.tiers[t] ??= now();
      effects?.push({ type: "tier", tier: t });
    }
    if (!st.pass.premium) return;
    while (st.pass.granted.premium < tier) {
      st.pass.granted.premium += 1;
      const t = st.pass.granted.premium;
      S.pass.tiers[t - 1].premium.forEach((reward, i) => grantReward(reward, "pass_premium", `pass:${S.season.id}:premium:${t}:${i}`, { tier: t }, effects));
    }
  }

  function addPassXp(amount, { capped }, effects) {
    if (!seasonActive() || !(amount > 0)) return { applied: 0, lost: 0, overflow: 0 };
    // O que passa do último tier é sobra, não perda para o teto: não vira nada (sem cauda paga).
    let offered = clampXp(S.pass, st.pass.xp, amount);
    const overflow = amount - offered;
    let lost = 0;
    const cap = S.pass.xp.dailyCap;
    if (capped && cap !== null && cap !== undefined) {
      const room = Math.max(0, cap - st.caps.passXp);
      lost = Math.max(0, offered - room);
      offered = Math.min(offered, room);
      st.caps.passXp += offered;
      st.caps.passXpLost = (st.caps.passXpLost ?? 0) + lost;
    }
    st.pass.xp += offered;
    st.pass.season = S.season.id;
    if (lost > 0) effects?.push({ type: "cap", what: "passXp", lost });
    grantTiers(effects);
    return { applied: offered, lost, overflow };
  }

  function creditCapped(currencyId, amount, source, txId, ref, effects) {
    const currency = index.currencies.get(currencyId);
    const earned = st.caps.currency[currencyId] ?? 0;
    const cap = currency?.dailyCap;
    const allowed = cap === null || cap === undefined ? amount : Math.max(0, Math.min(amount, cap - earned));
    const lost = amount - allowed;
    st.caps.currency[currencyId] = earned + allowed;
    if (lost > 0) {
      st.caps.currencyLost = st.caps.currencyLost ?? {};
      st.caps.currencyLost[currencyId] = (st.caps.currencyLost[currencyId] ?? 0) + lost;
      effects?.push({ type: "cap", what: currencyId, lost });
    }
    if (allowed > 0) credit(currencyId, allowed, source, txId, ref, effects);
  }

  function eventCurrency(event) {
    const rules = S.rewards;
    if (event.type === "match.finished" && rules.match) {
      const r = rules.match;
      return r.base + (isTopHalf(event) ? r.topHalf ?? 0 : 0) + (isPodium(event) ? r.podium ?? 0 : 0) + (isWin(event) ? r.win ?? 0 : 0);
    }
    if (event.type === "level.won" && rules.level) return rules.level.base + (rules.level.perStar ?? 0) * (event.stars ?? 0);
    if (event.type === "level.lost" && rules.level) return Math.floor(rules.level.base / 2);
    return 0;
  }

  // ---------- missões ----------
  function cycleKey(cycle) {
    if (cycle === "daily") return dayKey(now(), cfg);
    if (cycle === "weekly") return weekKey(now(), cfg);
    return periodKey("season", now(), cfg, S.season);
  }

  function ensureMissions() {
    for (const cycle of CYCLES) {
      const bucket = st.missions[cycle];
      if (bucket.key !== null && bucket.key !== undefined) continue;
      const key = cycleKey(cycle);
      const count = cycle === "daily" ? S.missions.daily.slots : cycle === "weekly" ? S.missions.weekly?.slots ?? 0 : Infinity;
      const ids = pickMissions(S.missions.pool, cycle, count, [S.series.id, cycle, key]);
      st.missions[cycle] = { ...bucket, key, list: ids.map(freshSlot) };
    }
  }

  function updateMissions(event, effects) {
    for (const cycle of CYCLES) {
      const bucket = st.missions[cycle];
      bucket.list = bucket.list.map((slot) => {
        if (slot.done) return slot;
        const def = index.missions.get(slot.id);
        if (!def || !eventMatches(def, event)) return slot;
        const next = advance(def, slot, event);
        const target = goalTarget(def);
        if (next.progress < target) return next;
        const done = { ...next, progress: target, done: true, doneAt: now() };
        def.reward.forEach((reward, j) => grantReward(reward, "mission", `mission:${cycle}:${bucket.key}:${def.id}:${j}`, { mission: def.id }, effects));
        st.funnel.first_mission ??= now();
        effects.push({ type: "mission", id: def.id, cycle });
        return done;
      });
    }
  }

  // ---------- relógios ----------
  const RESETS = {
    "missions.daily": () => { st.missions.daily = { ...st.missions.daily, key: null, list: [] }; },
    "rerolls.daily": () => { st.missions.daily.rerolls = 0; },
    "caps.daily": () => { st.caps = { passXp: 0, passXpLost: 0, currency: {}, currencyLost: {} }; },
    "consolation.daily": () => { st.dampers.consolations = 0; },
    "missions.weekly": () => { st.missions.weekly = { key: null, list: [] }; },
    "missions.season": () => { st.missions.season = { key: null, list: [] }; },
    "pass.progress": () => { st.pass.xp = 0; st.pass.granted = { free: 0, premium: 0 }; },
    "pass.premium": () => { st.pass.premium = false; },
    "offers.purchases": () => { st.offers = {}; },
    "trail.points": () => { st.trail.points = 0; },
    "streak.losses": () => { st.dampers.lossStreak = 0; },
  };

  function rollover(def, from, to, effects) {
    if (def.period === "season" && from === S.season.id) {
      st.history.push({
        season: from,
        xp: st.pass.xp,
        tier: progressFor(S.pass, st.pass.xp).tier,
        premium: st.pass.premium,
        closedAt: now(),
      });
    }
    for (const slot of def.expires) {
      if (!slot.startsWith("currency:")) continue;
      const currency = slot.slice("currency:".length);
      const balance = ledger.balance(currency);
      if (balance > 0) {
        ledger.post({ txId: `expiry:${def.id}:${from}:${currency}`, at: now(), currency, delta: -balance, sink: "expiry", ref: { clock: def.id, period: String(from) } });
        effects.push({ type: "expired", currency, amount: balance });
      }
    }
    for (const slot of [...def.resets, ...def.expires]) RESETS[slot]?.();
    effects.push({ type: "reset", clock: def.id, from, to });
  }

  function tick(effects = []) {
    for (const def of S.clocks.list) {
      const key = periodKey(def.period, now(), cfg, S.season);
      const previous = st.clocks[def.id];
      if (previous === key) continue;
      if (previous !== undefined && previous !== null) rollover(def, previous, key, effects);
      st.clocks[def.id] = key;
    }
    ensureMissions();
    return effects;
  }

  function starter(effects) {
    for (const item of S.store.starter ?? []) grantItem(item, "starter", `starter:${item}`, null, effects);
  }

  // ---------- amortecedores ----------
  function dampers(event, effects) {
    const consolation = S.dampers?.consolation;
    if (consolation) {
      if (isLoss(event)) st.dampers.lossStreak += 1;
      else st.dampers.lossStreak = 0;
      if (st.dampers.lossStreak >= consolation.afterLosses) {
        st.dampers.lossStreak = 0;
        if (st.dampers.consolations < consolation.perDay) {
          const n = st.dampers.consolations;
          st.dampers.consolations += 1;
          consolation.reward.forEach((reward, j) => grantReward(reward, "consolation", `consolation:${dayKey(now(), cfg)}:${n}:${j}`, null, effects));
          st.funnel.first_consolation ??= now();
          effects.push({ type: "consolation", suggest: consolation.suggest });
        } else {
          effects.push({ type: "consolation_limit" });
        }
      }
    }
    const trail = S.dampers?.trail;
    if (trail) {
      const before = st.trail.points;
      const { points, protected: saved } = applyTrail(trail, before, trailDelta(trail, event));
      st.trail.points = points;
      if (saved) effects.push({ type: "trail_protected", before, after: points });
      if (trailTier(trail, points) !== trailTier(trail, before)) effects.push({ type: "trail_tier", tier: trailTier(trail, points) });
    }
  }

  function firstTimes(event, effects) {
    for (const def of S.firstTime ?? []) {
      if (st.firstTime[def.id] || !eventMatches(def, event)) continue;
      st.firstTime[def.id] = now();
      def.reward.forEach((reward, j) => grantReward(reward, "first_time", `first:${def.id}:${j}`, null, effects));
      effects.push({ type: "first_time", id: def.id });
    }
  }

  // ---------- ações ----------
  function handle(event) {
    const effects = tick([]);
    const problem = validateEvent(event, index);
    if (problem) return { ok: false, reason: "invalid_event", detail: problem, effects };
    if (!seasonActive()) return { ok: false, reason: "season_inactive", effects };
    if (st.seenEvents.includes(event.id)) return { ok: true, duplicate: true, effects };
    st.seenEvents.push(event.id);
    if (st.seenEvents.length > SEEN_LIMIT) st.seenEvents.splice(0, st.seenEvents.length - SEEN_LIMIT);
    st.funnel.first_match ??= now();
    const gameState = (st.games[event.game] ??= { played: 0, wins: 0 });
    if (isIdle(S.pass, event)) {
      effects.push({ type: "idle", reason: "partida parada ou curta demais não paga" });
      return { ok: true, idle: true, effects };
    }
    gameState.played += 1;
    if (isWin(event)) gameState.wins += 1;
    const source = event.type === "match.finished" ? "match" : "level";
    creditCapped(S.rewards.currency, eventCurrency(event), source, `ev:${event.id}:moeda`, { game: event.game, type: event.type }, effects);
    addPassXp(eventXp(S.pass, event).xp, { capped: true }, effects);
    updateMissions(event, effects);
    firstTimes(event, effects);
    dampers(event, effects);
    return { ok: true, effects };
  }

  function unlockPremium() {
    const effects = tick([]);
    if (!seasonActive()) return { ok: false, reason: "season_inactive", effects };
    if (st.pass.premium) return { ok: false, reason: "premium_owned", effects };
    const { currency, amount } = S.pass.premium.price;
    const result = ledger.postAll(`premium:${S.season.id}`, [
      { at: now(), currency, delta: -amount, sink: "pass_premium" },
      { at: now(), item: `pass:${S.season.id}:premium`, delta: 1, source: "unlock" },
    ]);
    if (!result.ok) return { ok: false, reason: result.reason, effects };
    st.pass.premium = true;
    st.funnel.premium_unlocked ??= now();
    effects.push({ type: "premium" });
    grantTiers(effects);
    return { ok: true, effects };
  }

  function buy(cosmeticId) {
    const effects = tick([]);
    const cosmetic = index.cosmetics.get(cosmeticId);
    if (!cosmetic) return { ok: false, reason: "unknown_item", effects };
    if (ledger.owns(cosmeticId)) return { ok: false, reason: "already_owned", effects };
    const inRotation = rotation(S, dayKey(now(), cfg)).includes(cosmeticId);
    const inVault = !inRotation && vaultOpen(S, cosmetic, now());
    if (!inRotation && !inVault) return { ok: false, reason: "not_in_store", effects };
    const { currency, amount } = priceOf(S, cosmetic);
    const sink = inRotation ? "store" : "vault";
    const result = ledger.postAll(`buy:${cosmeticId}`, [
      { at: now(), currency, delta: -amount, sink },
      { at: now(), item: cosmeticId, delta: 1, source: sink },
    ]);
    if (!result.ok) return { ok: false, reason: result.reason, effects };
    st.funnel.first_store ??= now();
    effects.push({ type: "item", item: cosmeticId, source: sink });
    return { ok: true, effects };
  }

  function buyOffer(offerId) {
    const effects = tick([]);
    const offer = index.offers.get(offerId);
    if (!offer) return { ok: false, reason: "unknown_offer", effects };
    if (offerWindow(offer, now()) !== "active") return { ok: false, reason: "out_of_window", effects };
    const bought = st.offers[offerId] ?? 0;
    if (bought >= offer.limit) return { ok: false, reason: "purchase_limit", effects };
    const legs = [{ at: now(), currency: offer.price.currency, delta: -offer.price.amount, sink: "offer" }];
    const later = [];
    for (const reward of offer.grants) {
      if (reward.currency !== undefined) legs.push({ at: now(), currency: reward.currency, delta: reward.amount, source: "offer" });
      else if (reward.item !== undefined) {
        if (ledger.owns(reward.item)) {
          for (const dup of index.cosmetics.get(reward.item)?.duplicate ?? []) legs.push({ at: now(), currency: dup.currency, delta: dup.amount, source: "duplicate", ref: { item: reward.item } });
        } else {
          legs.push({ at: now(), item: reward.item, delta: 1, source: "offer" });
        }
      } else later.push(reward);
    }
    const result = ledger.postAll(`offer:${offerId}:${bought}`, legs);
    if (!result.ok) return { ok: false, reason: result.reason, effects };
    st.offers[offerId] = bought + 1;
    later.forEach((reward) => grantReward(reward, "offer", `offer:${offerId}:${bought}:xp`, null, effects));
    effects.push({ type: "offer", id: offerId });
    return { ok: true, effects };
  }

  function reroll(slotIndex) {
    const effects = tick([]);
    const bucket = st.missions.daily;
    if (bucket.rerolls >= S.missions.daily.freeRerolls) return { ok: false, reason: "reroll_limit", effects };
    const slot = bucket.list[slotIndex];
    if (!slot) return { ok: false, reason: "invalid_slot", effects };
    if (slot.done) return { ok: false, reason: "mission_done", effects };
    const active = new Set(bucket.list.map((item) => item.id));
    const candidates = S.missions.pool.filter((m) => m.cycle === "daily" && !active.has(m.id)).map((m) => m.id);
    if (candidates.length === 0) return { ok: false, reason: "no_candidate", effects };
    const pick = candidates[hashSeed(S.series.id, "reroll", bucket.key, bucket.rerolls, slotIndex) % candidates.length];
    bucket.list[slotIndex] = freshSlot(pick);
    bucket.rerolls += 1;
    effects.push({ type: "reroll", from: slot.id, to: pick });
    return { ok: true, effects };
  }

  function pull(tableId) {
    const effects = tick([]);
    const table = index.luck.get(tableId);
    if (!table) return { ok: false, reason: "unknown_table", effects };
    const allowed = checkLuck(st.profile, S.safety, S.luck);
    if (!allowed.ok) return { ok: false, reason: allowed.reason, effects };
    const pity = st.luck.pity[tableId] ?? 0;
    const pulls = st.luck.pulls[tableId] ?? 0;
    const rng = mulberry32(hashSeed("luck", st.playerId, tableId, pulls));
    const outcome = draw(table, pity, rng);
    const legs = [{ at: now(), currency: table.currency, delta: -table.cost, sink: "luck" }];
    const { odd } = outcome;
    if (odd.item !== undefined) {
      if (ledger.owns(odd.item)) {
        for (const dup of index.cosmetics.get(odd.item)?.duplicate ?? []) legs.push({ at: now(), currency: dup.currency, delta: dup.amount, source: "duplicate", ref: { item: odd.item } });
      } else {
        legs.push({ at: now(), item: odd.item, delta: 1, source: "luck" });
      }
    } else {
      legs.push({ at: now(), currency: odd.currency, delta: odd.amount, source: "luck" });
    }
    const result = ledger.postAll(`luck:${tableId}:${pulls}`, legs);
    if (!result.ok) return { ok: false, reason: result.reason, effects };
    st.luck.pity[tableId] = outcome.pity;
    st.luck.pulls[tableId] = pulls + 1;
    effects.push({ type: "luck", table: tableId, item: odd.item ?? null, currency: odd.currency ?? null, amount: odd.amount ?? null, guaranteed: outcome.guaranteed });
    return { ok: true, effects, outcome: { item: odd.item ?? null, currency: odd.currency ?? null, amount: odd.amount ?? null, guaranteed: outcome.guaranteed } };
  }

  function realPurchaseStatus(productId) {
    const product = index.products.get(productId);
    if (!product) return { ok: false, reason: "unknown_product" };
    const month = monthKey(now(), cfg);
    const safety = checkRealPurchase(st.profile, S.safety, { spentThisMonthCents: st.spend[month] ?? 0, priceCents: product.priceCents });
    if (!safety.ok) return safety;
    if (!S.realPurchase?.enabled) return { ok: false, band: safety.band, reason: "real_purchase_disabled" };
    if (!purchaseAdapter.enabled) return { ok: false, band: safety.band, reason: "adapter_disabled" };
    return { ok: true, band: safety.band, product, month };
  }

  function purchaseReal(productId) {
    const effects = tick([]);
    const status = realPurchaseStatus(productId);
    if (!status.ok) return { ok: false, reason: status.reason, effects };
    const { product, month } = status;
    const paid = purchaseAdapter.purchase({ product, playerId: st.playerId });
    if (!paid?.ok) return { ok: false, reason: paid?.reason ?? "adapter_refused", effects };
    st.spend[month] = (st.spend[month] ?? 0) + product.priceCents;
    if (product.grants === "pass.premium" && !st.pass.premium) {
      ledger.post({ txId: `real:${paid.receipt ?? product.id}:${month}:${st.spend[month]}`, at: now(), item: `pass:${S.season.id}:premium`, delta: 1, source: "real_purchase", ref: { cents: product.priceCents } });
      st.pass.premium = true;
      grantTiers(effects);
    }
    effects.push({ type: "real_purchase", product: product.id });
    return { ok: true, effects };
  }

  function setProfile(profile) {
    st.profile = { ...st.profile, ...profile };
    return { ok: true, band: ageBand(st.profile, S.safety) };
  }

  function equip(cosmeticId) {
    const cosmetic = index.cosmetics.get(cosmeticId);
    if (!cosmetic) return { ok: false, reason: "unknown_item" };
    if (!ledger.owns(cosmeticId)) return { ok: false, reason: "not_owned" };
    if (cosmetic.kind === "retrato") st.equipped.portrait = cosmeticId;
    else st.equipped.visuals[cosmetic.character] = cosmeticId;
    return { ok: true };
  }

  // ---------- leitura ----------
  function bucketView(cycle) {
    return st.missions[cycle].list.map((slot) => {
      const def = index.missions.get(slot.id);
      return { ...slot, title: def?.title ?? slot.id, game: def?.game ?? null, target: def ? goalTarget(def) : 0, reward: def?.reward ?? [] };
    });
  }

  function view() {
    tick([]);
    const at = now();
    const status = seasonStatus(at, S.season);
    const pass = S.pass;
    const marks = thresholds(pass);
    const progress = progressFor(pass, st.pass.xp);
    const band = ageBand(st.profile, S.safety);
    const trail = S.dampers?.trail;
    const productId = S.realPurchase?.products?.[0]?.id;
    return {
      now: at,
      playerId: st.playerId,
      profile: { ...st.profile },
      band,
      season: { id: S.season.id, name: S.season.name, validFrom: S.season.validFrom, validTo: S.season.validTo, endWarningDays: S.season.endWarningDays, ...status },
      clock: {
        resetHourUtc: cfg.resetHourUtc,
        weekStartsOn: cfg.weekStartsOn,
        day: dayKey(at, cfg),
        week: weekKey(at, cfg),
        month: monthKey(at, cfg),
        nextReset: nextDailyReset(at, cfg),
        list: S.clocks.list,
      },
      pass: {
        id: pass.id,
        name: pass.name ?? pass.id,
        tracks: pass.tracks ?? { free: "grátis", premium: "premium" },
        xp: st.pass.xp,
        total: totalXp(pass),
        progress,
        premium: st.pass.premium,
        price: pass.premium.price,
        xpToday: st.caps.passXp,
        xpLostToday: st.caps.passXpLost ?? 0,
        dailyCap: pass.xp.dailyCap,
        tiers: pass.tiers.map((tier, i) => ({ tier: i + 1, xp: tier.xp, at: marks[i], reached: progress.tier > i, free: tier.free, premium: tier.premium })),
      },
      wallet: S.currencies.map((currency) => ({
        id: currency.id,
        name: currency.name,
        icon: currency.icon ?? null,
        balance: ledger.balance(currency.id),
        today: st.caps.currency[currency.id] ?? 0,
        lostToday: st.caps.currencyLost?.[currency.id] ?? 0,
        dailyCap: currency.dailyCap ?? null,
        expiresWith: currency.expiresWith ?? null,
      })),
      missions: {
        daily: bucketView("daily"),
        weekly: bucketView("weekly"),
        season: bucketView("season"),
        rerollsLeft: Math.max(0, S.missions.daily.freeRerolls - st.missions.daily.rerolls),
      },
      store: {
        currency: S.store.currency,
        today: rotation(S, dayKey(at, cfg)).map((id) => {
          const cosmetic = index.cosmetics.get(id);
          return { cosmetic, price: priceOf(S, cosmetic), owned: ledger.owns(id) };
        }),
        vault: vaultItems(S, index, at).map((cosmetic) => ({ cosmetic, price: priceOf(S, cosmetic), owned: ledger.owns(cosmetic.id) })),
        nextRotation: nextDailyReset(at, cfg),
      },
      offers: (S.offers ?? []).map((offer) => ({ ...offer, window: offerWindow(offer, at), bought: st.offers[offer.id] ?? 0 })),
      collection: S.cosmetics.map((cosmetic) => ({ ...cosmetic, owned: ledger.owns(cosmetic.id) })),
      equipped: structuredClone(st.equipped),
      trail: trail ? { id: trail.id, name: trail.name, points: st.trail.points, tier: trailTier(trail, st.trail.points), thresholds: trail.thresholds, protection: trail.protection } : null,
      dampers: {
        lossStreak: st.dampers.lossStreak,
        afterLosses: S.dampers?.consolation?.afterLosses ?? null,
        consolationsToday: st.dampers.consolations,
        perDay: S.dampers?.consolation?.perDay ?? 0,
      },
      firstTime: (S.firstTime ?? []).map((def) => ({ id: def.id, title: def.title, game: def.game ?? null, doneAt: st.firstTime[def.id] ?? null })),
      safety: {
        band,
        realPurchase: productId ? realPurchaseStatus(productId) : { ok: false, reason: "unknown_product" },
        luck: checkLuck(st.profile, S.safety, S.luck),
        policy: S.safety,
      },
      luck: {
        enabled: Boolean(S.luck?.enabled),
        tables: (S.luck?.tables ?? []).map((table) => ({
          id: table.id,
          name: table.name,
          cost: table.cost,
          currency: table.currency,
          odds: displayOdds(table, index),
          pity: { after: table.pity.after, count: st.luck.pity[table.id] ?? 0, pool: table.pity.pool },
        })),
      },
      games: structuredClone(st.games),
      ledger: { size: ledger.size(), entries: ledger.entries(), totals: ledger.totals() },
      funnel: standardEvents(st, ledger.entries()),
      experiments: experiments(S, st.playerId, at),
      bundle: { id: bundle.id, version: bundle.version, title: bundle.title, hash: bundle.hash, sectionHashes: bundle.sectionHashes, overridden: bundle.overridden },
      history: structuredClone(st.history),
    };
  }

  function save() {
    return { ...structuredClone(st), ledger: ledger.entries() };
  }

  const effects = tick([]);
  starter(effects);

  return {
    handle,
    tick: () => tick([]),
    unlockPremium,
    buy,
    buyOffer,
    reroll,
    pull,
    purchaseReal,
    realPurchaseStatus,
    setProfile,
    equip,
    view,
    save,
    balance: (currency) => ledger.balance(currency),
    owns: (item) => ledger.owns(item),
    entries: () => ledger.entries(),
    totals: () => ledger.totals(),
    state: () => ({ ...structuredClone(st), ledger: ledger.entries() }),
    seasonStatus: season,
  };
}
