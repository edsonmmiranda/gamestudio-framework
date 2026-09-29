// Catálogo: validação estrutural e semântica, hash por seção e substituição por seção.
//
// A estrutura vem do esquema; o resto é regra de desenho que o esquema não expressa:
// referência que não existe, chance que não soma 1, relógio que zera a coleção,
// campo de segmentação por gasto. Cada recusa diz o campo e o porquê.

import { CATALOG_SCHEMA, EVENT_FIELDS, FORMAT, REQUIRED_SECTIONS } from "./catalog-schema.js";
import { NEVER_RESET, SLOTS } from "./clock.js";
import { shortHash } from "./hash.js";
import { isPlainObject, joinPath, validateSchema } from "./schema.js";

// Campos recusados em qualquer lugar do catálogo, com o motivo.
export const REFUSED_KEYS = Object.freeze({
  segment: "segmentação por gasto não existe no framework",
  segments: "segmentação por gasto não existe no framework",
  spendSegment: "segmentação por gasto não existe no framework",
  payerSegment: "segmentação por gasto não existe no framework",
  audience: "oferta, loja e aviso são iguais para todos; não há público por perfil de pagante",
  tail: "cauda paga depois do fim do passe é recusada",
  paidTail: "cauda paga depois do fim do passe é recusada",
  paidReroll: "troca de missão paga é recusada; a troca grátis é uma por dia",
  adReward: "recompensa por anúncio é recusada",
  fakeSocial: "sinal social falso é recusado",
  capMultiplier: "teto diário multiplicado por pagamento é recusado",
  paidFloor: "piso de divisão pago é recusado",
});

export function sectionHashes(sections) {
  const hashes = {};
  for (const name of Object.keys(sections).sort()) hashes[name] = shortHash(sections[name]);
  return hashes;
}

export function bundleHash(sections) {
  return shortHash(sectionHashes(sections));
}

function refusedKeyErrors(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => refusedKeyErrors(item, joinPath(path, index), errors));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = joinPath(path, key);
    if (Object.hasOwn(REFUSED_KEYS, key)) errors.push({ path: childPath, message: REFUSED_KEYS[key] });
    refusedKeyErrors(child, childPath, errors);
  }
}

function duplicates(list, path, errors) {
  const seen = new Map();
  (list ?? []).forEach((item, index) => {
    if (!item || typeof item.id !== "string") return;
    if (seen.has(item.id)) errors.push({ path: joinPath(joinPath(path, index), "id"), message: `id repetido: ${item.id} (já em [${seen.get(item.id)}])` });
    else seen.set(item.id, index);
  });
}

// Índice por id de cada lista do catálogo.
export function indexSections(sections) {
  const byId = (list) => new Map((list ?? []).map((item) => [item.id, item]));
  return {
    games: byId(sections.series?.games),
    currencies: byId(sections.currencies),
    cosmetics: byId(sections.cosmetics),
    missions: byId(sections.missions?.pool),
    offers: byId(sections.offers),
    firstTime: byId(sections.firstTime),
    luck: byId(sections.luck?.tables),
    products: byId(sections.realPurchase?.products),
    experiments: byId(sections.experiments),
    clocks: byId(sections.clocks?.list),
  };
}

function semanticErrors(sections) {
  const errors = [];
  const warnings = [];
  const index = indexSections(sections);
  const at = (path, message) => errors.push({ path, message });

  duplicates(sections.series?.games, "sections.series.games", errors);
  duplicates(sections.currencies, "sections.currencies", errors);
  duplicates(sections.cosmetics, "sections.cosmetics", errors);
  duplicates(sections.missions?.pool, "sections.missions.pool", errors);
  duplicates(sections.offers, "sections.offers", errors);
  duplicates(sections.firstTime, "sections.firstTime", errors);
  duplicates(sections.luck?.tables, "sections.luck.tables", errors);
  duplicates(sections.realPurchase?.products, "sections.realPurchase.products", errors);
  duplicates(sections.experiments, "sections.experiments", errors);
  duplicates(sections.clocks?.list, "sections.clocks.list", errors);

  const checkCurrency = (currency, path) => {
    if (!index.currencies.has(currency)) at(path, `moeda desconhecida: ${currency}`);
  };
  const checkItem = (item, path) => {
    if (!index.cosmetics.has(item)) at(path, `item desconhecido: ${item}`);
  };
  const checkRewards = (list, path, { allowItems = true, allowXp = true } = {}) => {
    (list ?? []).forEach((reward, i) => {
      const rewardPath = joinPath(path, i);
      const kinds = ["currency", "item", "passXp", "passTokens"].filter((kind) => reward[kind] !== undefined);
      if (kinds.length !== 1) {
        at(rewardPath, `recompensa precisa de exatamente um tipo (currency, item, passXp ou passTokens), tem ${kinds.length}`);
        return;
      }
      if (reward.currency !== undefined) {
        checkCurrency(reward.currency, joinPath(rewardPath, "currency"));
        if (reward.amount === undefined) at(joinPath(rewardPath, "amount"), "recompensa em moeda precisa de quantidade");
      } else if (reward.amount !== undefined) {
        at(joinPath(rewardPath, "amount"), "quantidade só vale para recompensa em moeda");
      }
      if (reward.item !== undefined) {
        if (!allowItems) at(joinPath(rewardPath, "item"), "aqui só cabe moeda (a conversão de duplicata não pode gerar outro item)");
        else checkItem(reward.item, joinPath(rewardPath, "item"));
      }
      if ((reward.passXp !== undefined || reward.passTokens !== undefined) && !allowXp) {
        at(rewardPath, "aqui só cabe moeda");
      }
      if (reward.passTokens !== undefined && !sections.pass?.tokens) {
        at(joinPath(rewardPath, "passTokens"), "token de passe exige sections.pass.tokens.xpPerToken");
      }
    });
  };
  const checkPrice = (price, path) => {
    if (!price) return;
    checkCurrency(price.currency, joinPath(path, "currency"));
    const currency = index.currencies.get(price.currency);
    if (currency && !currency.earned) {
      warnings.push({ path: joinPath(path, "currency"), message: `preço em moeda que não se ganha jogando (${price.currency})` });
    }
  };
  const checkWindow = (item, path, from = "validFrom", to = "validTo") => {
    if (!item || item[from] === undefined || item[to] === undefined) return;
    if (!(Date.parse(item[from]) < Date.parse(item[to]))) at(joinPath(path, to), `${to} precisa vir depois de ${from}`);
  };
  const checkGame = (game, path) => {
    if (game !== undefined && game !== null && !index.games.has(game)) at(path, `jogo desconhecido: ${game}`);
  };
  const checkConditions = (list, when, path) => {
    const allowed = EVENT_FIELDS[when] ?? [];
    (list ?? []).forEach((condition, i) => {
      const conditionPath = joinPath(path, i);
      if (!allowed.includes(condition.field)) at(joinPath(conditionPath, "field"), `o evento ${when} não tem o campo ${condition.field}`);
      const hasValue = condition.value !== undefined;
      const hasRef = condition.ref !== undefined;
      if (hasValue === hasRef) at(conditionPath, "condição precisa de value ou de ref (um dos dois)");
      if (hasRef && !allowed.includes(condition.ref)) at(joinPath(conditionPath, "ref"), `o evento ${when} não tem o campo ${condition.ref}`);
      if (condition.times !== undefined && !hasRef) at(joinPath(conditionPath, "times"), "times só vale com ref");
    });
  };

  // Moedas.
  (sections.currencies ?? []).forEach((currency, i) => {
    if (currency.purchasable) {
      warnings.push({ path: `sections.currencies[${i}].purchasable`, message: "moeda comprável com dinheiro exige compra real, aferição de idade e revisão jurídica" });
    }
  });

  // Relógios.
  const clocks = sections.clocks?.list ?? [];
  const periods = new Set(clocks.map((clock) => clock.period));
  if (sections.clocks) {
    if (!periods.has("daily")) at("sections.clocks.list", "falta o relógio diário (period: daily)");
    if (!periods.has("season")) at("sections.clocks.list", "falta o relógio da temporada (period: season)");
  }
  clocks.forEach((clock, i) => {
    const clockPath = `sections.clocks.list[${i}]`;
    for (const list of ["resets", "accumulates", "expires"]) {
      (clock[list] ?? []).forEach((slot, j) => {
        const slotPath = `${clockPath}.${list}[${j}]`;
        if (slot.startsWith("currency:")) {
          const currencyId = slot.slice("currency:".length);
          const currency = index.currencies.get(currencyId);
          if (!currency) at(slotPath, `moeda desconhecida: ${currencyId}`);
          else if (list === "expires" && currency.expiresWith !== clock.period) {
            at(slotPath, `${currencyId} vence com ${currency.expiresWith ?? "nada"}, não com ${clock.period}`);
          } else if (list === "resets") {
            at(slotPath, "moeda não se reinicia; declare expiresWith na moeda e ponha em expires");
          }
        } else if (!Object.hasOwn(SLOTS, slot)) {
          at(slotPath, `peça de estado desconhecida: ${slot}`);
        } else if (list !== "accumulates" && NEVER_RESET.includes(slot)) {
          at(slotPath, `${slot} nunca zera (o que o jogador ganhou fica)`);
        }
      });
    }
    const required = {
      daily: ["missions.daily", "rerolls.daily", "caps.daily"],
      weekly: (sections.missions?.weekly?.slots ?? 0) > 0 ? ["missions.weekly"] : [],
      season: ["pass.progress", "pass.premium", "missions.season"],
    }[clock.period] ?? [];
    for (const slot of required) {
      if (!(clock.resets ?? []).includes(slot)) at(`${clockPath}.resets`, `o relógio ${clock.period} precisa reiniciar ${slot}`);
    }
  });
  (sections.currencies ?? []).forEach((currency, i) => {
    if (!currency.expiresWith) return;
    const owner = clocks.find((clock) => clock.period === currency.expiresWith);
    if (!owner || !(owner.expires ?? []).includes(`currency:${currency.id}`)) {
      at(`sections.currencies[${i}].expiresWith`, `o relógio ${currency.expiresWith} precisa declarar currency:${currency.id} em expires`);
    }
  });
  if ((sections.missions?.weekly?.slots ?? 0) > 0 && !periods.has("weekly")) {
    at("sections.clocks.list", "missões semanais exigem o relógio semanal (period: weekly)");
  }

  // Temporada e passe.
  checkWindow(sections.season, "sections.season");
  if (sections.pass && sections.season && sections.pass.season !== sections.season.id) {
    at("sections.pass.season", `o passe aponta a temporada ${sections.pass.season}, mas a temporada é ${sections.season.id}`);
  }
  (sections.pass?.tiers ?? []).forEach((tier, i) => {
    checkRewards(tier.free, `sections.pass.tiers[${i}].free`, { allowXp: false });
    checkRewards(tier.premium, `sections.pass.tiers[${i}].premium`, { allowXp: false });
  });
  checkPrice(sections.pass?.premium?.price, "sections.pass.premium.price");

  // Recompensa de partida.
  if (sections.rewards) checkCurrency(sections.rewards.currency, "sections.rewards.currency");

  // Missões.
  const pool = sections.missions?.pool ?? [];
  pool.forEach((m, i) => {
    const path = `sections.missions.pool[${i}]`;
    checkGame(m.game, `${path}.game`);
    checkConditions(m.where, m.when, `${path}.where`);
    checkRewards(m.reward, `${path}.reward`);
    const goal = m.goal ?? {};
    const shapes = [goal.count !== undefined, goal.sum !== undefined, goal.distinct !== undefined].filter(Boolean).length;
    if (shapes !== 1) at(`${path}.goal`, "meta precisa de exatamente uma forma: count, sum+target ou distinct+target");
    if ((goal.sum !== undefined || goal.distinct !== undefined) && goal.target === undefined) at(`${path}.goal.target`, "sum e distinct precisam de target");
    if (goal.count !== undefined && goal.target !== undefined) at(`${path}.goal.target`, "count já é a meta; target sobra");
    if (goal.sum !== undefined && !(EVENT_FIELDS[m.when] ?? []).includes(goal.sum)) at(`${path}.goal.sum`, `o evento ${m.when} não tem o campo ${goal.sum}`);
  });
  const cycleCount = (cycle) => pool.filter((m) => m.cycle === cycle).length;
  if (sections.missions && sections.missions.daily.slots > cycleCount("daily")) {
    at("sections.missions.daily.slots", `pede ${sections.missions.daily.slots} missões do dia, o conjunto tem ${cycleCount("daily")}`);
  }
  if (sections.missions?.weekly && sections.missions.weekly.slots > cycleCount("weekly")) {
    at("sections.missions.weekly.slots", `pede ${sections.missions.weekly.slots} missões da semana, o conjunto tem ${cycleCount("weekly")}`);
  }

  (sections.firstTime ?? []).forEach((f, i) => {
    const path = `sections.firstTime[${i}]`;
    checkGame(f.game, `${path}.game`);
    checkConditions(f.where, f.when, `${path}.where`);
    checkRewards(f.reward, `${path}.reward`);
  });

  // Cosméticos, loja e ofertas.
  (sections.cosmetics ?? []).forEach((c, i) => {
    checkRewards(c.duplicate, `sections.cosmetics[${i}].duplicate`, { allowItems: false, allowXp: false });
    checkWindow(c, `sections.cosmetics[${i}]`);
  });
  if (sections.store) {
    checkCurrency(sections.store.currency, "sections.store.currency");
    sections.store.rotation.pool.forEach((item, i) => checkItem(item, `sections.store.rotation.pool[${i}]`));
    (sections.store.vault?.pool ?? []).forEach((item, i) => {
      checkItem(item, `sections.store.vault.pool[${i}]`);
      const cosmetic = index.cosmetics.get(item);
      if (cosmetic && !cosmetic.validTo) at(`sections.store.vault.pool[${i}]`, `${item} precisa de validTo para saber quando saiu de circulação`);
    });
    (sections.store.starter ?? []).forEach((item, i) => checkItem(item, `sections.store.starter[${i}]`));
  }
  (sections.offers ?? []).forEach((offer, i) => {
    checkWindow(offer, `sections.offers[${i}]`);
    checkPrice(offer.price, `sections.offers[${i}].price`);
    checkRewards(offer.grants, `sections.offers[${i}].grants`);
  });

  // Amortecedores.
  const consolation = sections.dampers?.consolation;
  if (consolation) checkRewards(consolation.reward, "sections.dampers.consolation.reward");
  const trail = sections.dampers?.trail;
  if (trail) {
    trail.thresholds.forEach((value, i) => {
      if (i > 0 && value <= trail.thresholds[i - 1]) at(`sections.dampers.trail.thresholds[${i}]`, "os limiares precisam crescer");
    });
    if (trail.thresholds[0] !== 0) at("sections.dampers.trail.thresholds[0]", "a trilha começa em 0");
  }

  // Sorte.
  const luck = sections.luck;
  if (luck) {
    if (luck.enabled && luck.tables.length === 0) at("sections.luck.tables", "sorte ligada sem tabela");
    luck.tables.forEach((table, i) => {
      const path = `sections.luck.tables[${i}]`;
      const currency = index.currencies.get(table.currency);
      if (!currency) at(`${path}.currency`, `moeda desconhecida: ${table.currency}`);
      else if (!currency.earned || currency.purchasable) {
        at(`${path}.currency`, `sorte só com moeda ganha e não comprável; ${table.currency} não serve (ECA Digital, art. 20)`);
      }
      const sum = table.odds.reduce((total, odd) => total + (Number.isFinite(odd.p) ? odd.p : 0), 0);
      if (Math.abs(sum - 1) > 1e-9) at(`${path}.odds`, `as chances somam ${Number(sum.toFixed(6))}; precisam somar 1 (chance à vista e honesta)`);
      table.odds.forEach((odd, j) => {
        const kinds = [odd.item !== undefined, odd.currency !== undefined].filter(Boolean).length;
        if (kinds !== 1) at(`${path}.odds[${j}]`, "cada chance dá um item ou uma quantidade de moeda");
        if (odd.item !== undefined) checkItem(odd.item, `${path}.odds[${j}].item`);
        if (odd.currency !== undefined) {
          checkCurrency(odd.currency, `${path}.odds[${j}].currency`);
          if (odd.amount === undefined) at(`${path}.odds[${j}].amount`, "moeda precisa de quantidade");
        }
      });
      const items = new Set(table.odds.map((odd) => odd.item).filter(Boolean));
      table.pity.pool.forEach((item, j) => {
        if (!items.has(item)) at(`${path}.pity.pool[${j}]`, `a garantia aponta ${item}, que não está na tabela`);
      });
    });
  }

  // Segurança.
  const safety = sections.safety;
  if (safety && safety.childBelow >= safety.adultAge) at("sections.safety.childBelow", "a idade de criança precisa ficar abaixo da maioridade");

  // Compra real.
  if (sections.realPurchase?.enabled) {
    warnings.push({ path: "sections.realPurchase.enabled", message: "compra real ligada: só depois de aferição de idade, controle parental, estorno e revisão jurídica" });
  }

  (sections.experiments ?? []).forEach((experiment, i) => checkWindow(experiment, `sections.experiments[${i}]`, "startsAt", "endsAt"));

  return { errors, warnings };
}

export function validateBundle(raw) {
  const refused = [];
  if (isPlainObject(raw?.sections)) refusedKeyErrors(raw.sections, "sections", refused);
  const structural = validateSchema(raw, CATALOG_SCHEMA);
  // Campo recusado também é "campo desconhecido" para o esquema; fica a mensagem que explica.
  const refusedPaths = new Set(refused.map((error) => error.path));
  const errors = [...refused, ...structural.filter((error) => !refusedPaths.has(error.path))];
  if (errors.length > 0 || !isPlainObject(raw?.sections)) return { ok: false, errors, warnings: [] };
  const semantic = semanticErrors(raw.sections);
  return { ok: semantic.errors.length === 0, errors: semantic.errors, warnings: semantic.warnings };
}

// Carrega o pacote. `overrides` troca seções inteiras (como uma configuração remota por
// seção faria); o hash é recalculado e o hash declarado só vale para o arquivo intacto.
export function loadBundle(raw, { overrides = {} } = {}) {
  const overridden = Object.keys(overrides).filter((name) => overrides[name] !== undefined).sort();
  const candidate = overridden.length
    ? { ...raw, sections: { ...raw.sections, ...Object.fromEntries(overridden.map((name) => [name, overrides[name]])) } }
    : raw;
  const { ok, errors, warnings } = validateBundle(candidate);
  if (!ok) return { ok: false, errors, warnings, bundle: null };
  const hashes = sectionHashes(candidate.sections);
  const hash = shortHash(hashes);
  if (!overridden.length && raw.hash !== undefined && raw.hash !== hash) {
    return {
      ok: false,
      errors: [{ path: "hash", message: `declarado ${raw.hash}, calculado ${hash}: o arquivo mudou sem refazer o hash (tools/rehash.mjs)` }],
      warnings,
      bundle: null,
    };
  }
  const bundle = Object.freeze({
    format: FORMAT,
    id: candidate.id,
    version: candidate.version,
    title: candidate.title ?? candidate.id,
    hash,
    declaredHash: raw.hash ?? null,
    sectionHashes: hashes,
    overridden,
    sections: candidate.sections,
    index: indexSections(candidate.sections),
  });
  return { ok: true, errors: [], warnings, bundle };
}

// Fontes de configuração: o disco agora; o servidor fica como adaptador desligado.
export function diskSource(raw) {
  return { kind: "disk", enabled: true, load: () => ({ ok: true, raw, origin: "disk" }) };
}

export const remoteSource = Object.freeze({
  kind: "remote",
  enabled: false,
  load: () => ({ ok: false, reason: "remote_disabled", origin: "remote" }),
});

export { FORMAT, REQUIRED_SECTIONS };
