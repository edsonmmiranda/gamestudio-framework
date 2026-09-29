// Sorte opcional, desligada por padrão.
//
// Quando ligada: só com moeda ganha, chance à vista somando 1, garantia escrita
// e reserva de duplicata (a tabela de pesos pode reservar por item). Proibida para menor
// e idade desconhecida (ECA Digital, art. 20) — a checagem mora em `safety.js`.

import { pickWeighted } from "./rng.js";

export function displayOdds(table, index) {
  return table.odds.map((odd) => {
    const label = odd.item !== undefined
      ? index.cosmetics.get(odd.item)?.name ?? odd.item
      : `${odd.amount} ${index.currencies.get(odd.currency)?.name ?? odd.currency}`;
    return { label, item: odd.item ?? null, currency: odd.currency ?? null, amount: odd.amount ?? null, percent: odd.p * 100 };
  });
}

// Uma tirada. `pity` é quantas tiradas seguidas saíram sem item da garantia.
// Na tirada de número `after`, sem ter saído, a garantia sai.
export function draw(table, pity, rng) {
  const inPool = (odd) => odd.item !== undefined && table.pity.pool.includes(odd.item);
  const guaranteed = pity + 1 >= table.pity.after;
  let odd;
  if (guaranteed) {
    const pool = table.odds.filter(inPool);
    odd = pool[pickWeighted(rng, pool.map((candidate) => candidate.p))];
  } else {
    odd = table.odds[pickWeighted(rng, table.odds.map((candidate) => candidate.p))];
  }
  const hit = inPool(odd);
  return { odd, guaranteed: guaranteed && hit, pity: hit ? 0 : pity + 1 };
}
