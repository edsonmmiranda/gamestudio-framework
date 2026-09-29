// Loja, cofre e ofertas: preço em moeda do jogo, rotação diária igual para todos,
// oferta com janela e limite de compra.
//
// O cofre é o princípio: o que sai de circulação volta depois (as skins de passe de
// temporadas antigas voltam no cofre).
// Segmentação por gasto não existe aqui: a rotação usa só o catálogo e o dia.

import { DAY_MS } from "./clock.js";
import { hashSeed, mulberry32, shuffled } from "./rng.js";

export function rotation(sections, day) {
  const { slots, pool } = sections.store.rotation;
  const rng = mulberry32(hashSeed("store", sections.series.id, day));
  return shuffled(rng, pool).slice(0, Math.min(slots, pool.length));
}

export function priceOf(sections, cosmetic) {
  return { currency: sections.store.currency, amount: sections.store.prices[cosmetic.rarity] };
}

// O item está no cofre quando saiu de circulação há pelo menos `returnsAfterDays`.
export function vaultOpen(sections, cosmetic, now) {
  const vault = sections.store.vault;
  if (!vault || !vault.pool.includes(cosmetic.id) || !cosmetic.validTo) return false;
  return now >= Date.parse(cosmetic.validTo) + vault.returnsAfterDays * DAY_MS;
}

export function vaultItems(sections, index, now) {
  return (sections.store.vault?.pool ?? [])
    .map((id) => index.cosmetics.get(id))
    .filter((cosmetic) => cosmetic && vaultOpen(sections, cosmetic, now));
}

export function offerWindow(offer, now) {
  if (now < Date.parse(offer.validFrom)) return "before";
  if (now >= Date.parse(offer.validTo)) return "ended";
  return "active";
}
