// Livro-razão: só acrescenta, nunca edita.
//
// Todo movimento de moeda ou de posse é um lançamento com origem (crédito) ou
// sumidouro (débito) de vocabulário fechado, com o motivo rotulado em cada entrada.
// Saldo e posse são derivados da soma; nada guarda saldo em paralelo.
// O `txId` torna o lançamento idempotente: o mesmo evento repetido não paga duas vezes.

export const SOURCES = Object.freeze({
  match: "partida",
  level: "fase",
  mission: "missão",
  pass_free: "passe · trilha grátis",
  pass_premium: "passe · trilha premium",
  first_time: "primeira vez",
  consolation: "consolo",
  event: "evento",
  duplicate: "duplicata convertida",
  store: "loja",
  offer: "oferta",
  vault: "cofre",
  unlock: "desbloqueio com moeda",
  luck: "sorte",
  starter: "início",
  real_purchase: "compra real",
  correction: "correção",
});

export const SINKS = Object.freeze({
  store: "loja",
  offer: "oferta",
  vault: "cofre",
  pass_premium: "passe premium",
  luck: "sorte",
  expiry: "venceu",
  correction: "correção",
});

// Sumidouros de uso: o jogador escolheu gastar. `expiry` e `correction` tiram
// moeda, mas não contam como sumidouro de desenho (uma moeda que só vence é torneira quebrada).
export const SPEND_SINKS = Object.freeze(["store", "offer", "vault", "pass_premium", "luck"]);

const keyOf = (entry) => (entry.currency !== undefined ? `c:${entry.currency}` : `i:${entry.item}`);

function normalize(raw) {
  if (raw === null || typeof raw !== "object") return { reason: "entry_invalid" };
  const { txId, at, currency, item, delta, source, sink, ref } = raw;
  if (typeof txId !== "string" || txId.length === 0) return { reason: "txid_required" };
  if (!Number.isFinite(at)) return { reason: "at_required" };
  const hasCurrency = typeof currency === "string" && currency.length > 0;
  const hasItem = typeof item === "string" && item.length > 0;
  if (hasCurrency === hasItem) return { reason: "asset_required" };
  if (!Number.isInteger(delta) || delta === 0) return { reason: "delta_invalid" };
  if (delta > 0) {
    if (source === undefined) return { reason: "source_required" };
    if (!Object.hasOwn(SOURCES, source)) return { reason: "source_unknown" };
    if (sink !== undefined) return { reason: "sink_on_credit" };
  } else {
    if (sink === undefined) return { reason: "sink_required" };
    if (!Object.hasOwn(SINKS, sink)) return { reason: "sink_unknown" };
    if (source !== undefined) return { reason: "source_on_debit" };
  }
  const entry = { txId, at, delta };
  if (hasCurrency) entry.currency = currency;
  else entry.item = item;
  if (delta > 0) entry.source = source;
  else entry.sink = sink;
  if (ref !== undefined) entry.ref = ref;
  return { entry };
}

const sameEntry = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createLedger(initial = []) {
  const entries = [];
  const byTx = new Map();
  const balances = new Map();
  const rejected = [];

  function commit(entry) {
    const frozen = Object.freeze({ ...entry });
    entries.push(frozen);
    byTx.set(frozen.txId, frozen);
    const key = keyOf(frozen);
    balances.set(key, (balances.get(key) ?? 0) + frozen.delta);
    return frozen;
  }

  function post(raw) {
    const { entry, reason } = normalize(raw);
    if (!entry) return { ok: false, reason };
    const existing = byTx.get(entry.txId);
    if (existing) {
      return sameEntry(existing, entry)
        ? { ok: true, duplicate: true, entry: existing }
        : { ok: false, reason: "txid_conflict" };
    }
    const key = keyOf(entry);
    if ((balances.get(key) ?? 0) + entry.delta < 0) {
      return { ok: false, reason: entry.currency !== undefined ? "insufficient_funds" : "not_owned" };
    }
    return { ok: true, entry: commit(entry) };
  }

  // Várias pernas numa transação: tudo entra ou nada entra (compra = débito + posse).
  function postAll(txId, legs) {
    const normalized = [];
    for (let i = 0; i < legs.length; i += 1) {
      const { entry, reason } = normalize({ ...legs[i], txId: `${txId}#${i}` });
      if (!entry) return { ok: false, reason };
      normalized.push(entry);
    }
    if (normalized.length === 0) return { ok: false, reason: "entry_invalid" };
    const existing = normalized.map((entry) => byTx.get(entry.txId));
    if (existing.some(Boolean)) {
      const identical = existing.every((found, i) => found && sameEntry(found, normalized[i]));
      return identical ? { ok: true, duplicate: true, entries: existing } : { ok: false, reason: "txid_conflict" };
    }
    const tentative = new Map();
    for (const entry of normalized) {
      const key = keyOf(entry);
      const next = (tentative.get(key) ?? balances.get(key) ?? 0) + entry.delta;
      if (next < 0) return { ok: false, reason: entry.currency !== undefined ? "insufficient_funds" : "not_owned" };
      tentative.set(key, next);
    }
    return { ok: true, entries: normalized.map(commit) };
  }

  const balance = (currency) => balances.get(`c:${currency}`) ?? 0;
  const count = (item) => balances.get(`i:${item}`) ?? 0;

  function totals() {
    const currencies = {};
    const items = {};
    for (const entry of entries) {
      if (entry.currency !== undefined) {
        const row = (currencies[entry.currency] ??= { sourced: 0, spent: 0, expired: 0, corrected: 0, balance: 0, bySource: {}, bySink: {} });
        row.balance += entry.delta;
        if (entry.delta > 0) {
          row.sourced += entry.delta;
          row.bySource[entry.source] = (row.bySource[entry.source] ?? 0) + entry.delta;
        } else {
          const amount = -entry.delta;
          if (entry.sink === "expiry") row.expired += amount;
          else if (entry.sink === "correction") row.corrected += amount;
          else row.spent += amount;
          row.bySink[entry.sink] = (row.bySink[entry.sink] ?? 0) + amount;
        }
      } else {
        items[entry.item] = (items[entry.item] ?? 0) + entry.delta;
      }
    }
    return { currencies, items };
  }

  for (const raw of initial) {
    const result = post(raw);
    if (!result.ok) rejected.push({ entry: raw, reason: result.reason });
  }

  return {
    post,
    postAll,
    balance,
    count,
    owns: (item) => count(item) > 0,
    has: (txId) => byTx.has(txId),
    get: (txId) => byTx.get(txId),
    entries: () => entries.slice(),
    size: () => entries.length,
    totals,
    rejected: () => rejected.slice(),
  };
}

// Confere, do zero, as invariantes de uma sequência de lançamentos já gravada.
// Serve ao teste de propriedade e ao controle negativo (um livro adulterado falha).
export function checkLedger(entries) {
  const problems = [];
  const seen = new Set();
  const running = new Map();
  entries.forEach((raw, index) => {
    const { entry, reason } = normalize(raw);
    if (!entry) {
      problems.push({ index, problem: reason });
      return;
    }
    if (seen.has(entry.txId)) problems.push({ index, problem: "txid_repeated" });
    seen.add(entry.txId);
    const key = keyOf(entry);
    const next = (running.get(key) ?? 0) + entry.delta;
    if (next < 0) problems.push({ index, problem: "negative_balance", key, balance: next });
    running.set(key, next);
  });
  return { ok: problems.length === 0, problems, balances: Object.fromEntries(running) };
}
