// Instrumentação: eventos padronizados derivados do livro-razão e do funil, e
// bandeiras A/B com início e fim.
//
// O livro-razão já é a instrumentação da economia (cada movimento tem motivo rotulado).
// O funil guarda o primeiro momento de cada passo. As bandeiras têm início e fim, como
// e atribuição por hash do jogador, estável.
// Nada é enviado: quem consome decide para onde vai, e o pacote não envia nada.

import { hashSeed } from "./rng.js";

export const FUNNEL_STEPS = Object.freeze({
  first_match: "primeira partida",
  first_mission: "primeira missão cumprida",
  first_store: "primeiro visual comprado com moeda",
  premium_unlocked: "trilha premium liberada com moeda",
  pass_tier: "tier do passe alcançado",
  first_consolation: "primeiro consolo",
});

export function standardEvents(state, entries) {
  const events = [];
  for (const [step, at] of Object.entries(state.funnel ?? {})) {
    if (step === "tiers") continue;
    if (Number.isFinite(at)) events.push({ name: step, at });
  }
  for (const [tier, at] of Object.entries(state.funnel?.tiers ?? {})) {
    events.push({ name: "pass_tier", tier: Number(tier), at });
  }
  for (const entry of entries) {
    if (entry.delta < 0 && entry.currency !== undefined && entry.sink !== "expiry") {
      events.push({ name: "currency_spent", at: entry.at, currency: entry.currency, amount: -entry.delta, sink: entry.sink });
    }
  }
  return events.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

export function experimentState(experiment, playerId, now) {
  const start = Date.parse(experiment.startsAt);
  const end = Date.parse(experiment.endsAt);
  const active = now >= start && now < end;
  const variant = experiment.variants[hashSeed("ab", experiment.id, playerId) % experiment.variants.length];
  return { id: experiment.id, title: experiment.title ?? experiment.id, active, variant: active ? variant : null, startsAt: experiment.startsAt, endsAt: experiment.endsAt };
}

export function experiments(sections, playerId, now) {
  return (sections.experiments ?? []).map((experiment) => experimentState(experiment, playerId, now));
}
