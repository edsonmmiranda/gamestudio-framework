// Proteção de menores, ligada por padrão.
//
// O piso é o mais protetor entre os padrões de mercado, não a média: conta de criança
// não compra, menor tem limite mensal de gasto, nenhuma sorte para menor (ECA Digital,
// art. 20). Idade desconhecida conta como menor; autodeclaração de adulto não basta
// por padrão ("informar só CPF equivaleria a autodeclaração", guia da ANPD).

export const BANDS = Object.freeze({ child: "criança", minor: "menor", adult: "adulto" });

export function defaultProfile() {
  return { age: null, ageSource: "unknown", childAccount: false, guardianLinked: false };
}

export function ageBand(profile, policy) {
  const p = { ...defaultProfile(), ...(profile ?? {}) };
  if (p.childAccount === true) return "child";
  if (!Number.isFinite(p.age) || p.ageSource === "unknown") return "minor";
  if (p.age < policy.childBelow) return "child";
  if (p.age < policy.adultAge) return "minor";
  if (p.ageSource === "verified") return "adult";
  return policy.trustSelfDeclaredAdult ? "adult" : "minor";
}

export function checkRealPurchase(profile, policy, { spentThisMonthCents = 0, priceCents = 0 } = {}) {
  const band = ageBand(profile, policy);
  if (band === "child") return { ok: false, band, reason: "child_account" };
  if (band === "minor") {
    if (policy.minorNeedsGuardian && !profile?.guardianLinked) return { ok: false, band, reason: "minor_needs_guardian" };
    if (spentThisMonthCents + priceCents > policy.minorMonthlyLimitCents) return { ok: false, band, reason: "minor_monthly_limit" };
  }
  return { ok: true, band };
}

export function checkLuck(profile, policy, luck) {
  const band = ageBand(profile, policy);
  if (!luck || !luck.enabled) return { ok: false, band, reason: "luck_disabled" };
  if (band !== "adult") return { ok: false, band, reason: band === "child" ? "luck_child" : "luck_minor" };
  return { ok: true, band };
}

// Textos das recusas, para a interface e para o livro de bordo.
export const REASONS = Object.freeze({
  child_account: "conta de criança não compra",
  minor_needs_guardian: "menor só compra com responsável vinculado",
  minor_monthly_limit: "passaria do limite mensal de gasto do menor",
  luck_disabled: "sorte desligada no catálogo",
  luck_minor: "sorte proibida para menor ou idade desconhecida",
  luck_child: "sorte proibida para criança",
  real_purchase_disabled: "compra real desligada no catálogo",
  adapter_disabled: "adaptador de compra real desligado",
  insufficient_funds: "saldo insuficiente",
  not_owned: "não tem esse item",
  already_owned: "já é seu",
  not_in_store: "não está na loja hoje",
  out_of_window: "fora da janela da oferta",
  purchase_limit: "limite de compra da oferta atingido",
  reroll_limit: "a troca grátis de hoje já foi usada",
  mission_done: "missão já cumprida",
  no_candidate: "não há outra missão para trocar",
  season_inactive: "a temporada não está aberta",
  premium_owned: "a trilha premium já está liberada",
  invalid_event: "evento inválido",
  unknown_item: "item desconhecido",
  unknown_offer: "oferta desconhecida",
  unknown_product: "produto desconhecido",
  unknown_table: "tabela de sorte desconhecida",
  txid_conflict: "lançamento com o mesmo id e conteúdo diferente",
});
