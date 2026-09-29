// Ponto de entrada do pacote de gamificação do estúdio.
// Receita: recipes/gamification.md. Uso e limites: packages/gamification/README.md.

export { FORMAT, CATALOG_SCHEMA, SECTION_SCHEMAS, REQUIRED_SECTIONS, EVENT_TYPES, EVENT_FIELDS } from "./catalog-schema.js";
export { loadBundle, validateBundle, sectionHashes, bundleHash, indexSections, diskSource, remoteSource, REFUSED_KEYS } from "./catalog.js";
export { createLedger, checkLedger, SOURCES, SINKS, SPEND_SINKS } from "./ledger.js";
export {
  manualClock, systemClock, dayKey, dayStart, nextDailyReset, weekKey, weekday, monthKey,
  seasonStatus, seasonKey, periodKey, SLOTS, NEVER_RESET, DAY_MS, HOUR_MS,
} from "./clock.js";
export { createGamification, validateEvent } from "./engine.js";
export { thresholds, totalXp, tierFor, progressFor, eventXp, clampXp, tokensAllowed, isIdle } from "./pass.js";
export { conditionHolds, eventMatches, pickMissions } from "./missions.js";
export { rotation, priceOf, vaultOpen, vaultItems, offerWindow } from "./store.js";
export { isLoss, applyTrail, trailTier, trailDelta } from "./dampers.js";
export { draw, displayOdds } from "./luck.js";
export { ageBand, checkRealPurchase, checkLuck, defaultProfile, BANDS, REASONS } from "./safety.js";
export { disabledPurchaseAdapter } from "./purchase.js";
export { standardEvents, experiments, experimentState, FUNNEL_STEPS } from "./telemetry.js";
export { defaultState, restore, serialize, STATE_SCHEMA } from "./state.js";
export {
  simulateSeason, runPersona, summarize, analyzeCatalog, passXpUpperBound, cosmeticPaths,
  sessionEvents, makeEvent, personaGames, isActiveDay, spendPolicy, rerollForeign,
  runPersonaSeeds, DEFAULT_PERSONAS, DEFAULT_CRITERIA, DEFAULT_SEEDS, SIMULATION_FORMAT, SESSION_OFFSETS_H,
} from "./simulate.js";
export { sha256Hex, canonicalJson, shortHash } from "./hash.js";
export { hashSeed, mulberry32 } from "./rng.js";
export { validateSchema, formatError } from "./schema.js";
