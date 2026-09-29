// Esquema do catálogo (formato alanstudio.gamification/1).
//
// É a fonte canônica: `schemas/catalog.schema.json` é exportado daqui por
// `tools/export-schema.mjs`, e um teste confere que os dois não divergem.
// O catálogo é um pacote de seções com hash, que pode vir do disco agora e de um
// servidor depois, com substituição por seção.

export const FORMAT = "alanstudio.gamification/1";

const id = { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]*$" };
const version = { type: "integer", minimum: 1 };
const dateTime = { type: "string", format: "date-time" };
const text = { type: "string", minLength: 1 };
const count = { type: "integer", minimum: 0 };
const positive = { type: "integer", minimum: 1 };

const reward = {
  type: "object",
  additionalProperties: false,
  properties: {
    currency: id,
    amount: positive,
    item: id,
    passXp: positive,
    passTokens: positive,
  },
};
const rewards = { type: "array", items: reward };

const price = {
  type: "object",
  required: ["currency", "amount"],
  additionalProperties: false,
  properties: { currency: id, amount: positive },
};

export const EVENT_FIELDS = Object.freeze({
  "match.finished": ["placement", "players", "kills", "durationS", "wave", "won", "mode", "idle"],
  "level.won": ["stars", "level", "durationS", "idle"],
  "level.lost": ["level", "durationS", "idle"],
});
export const EVENT_TYPES = Object.freeze(Object.keys(EVENT_FIELDS));
const ALL_FIELDS = [...new Set(Object.values(EVENT_FIELDS).flat())];

const condition = {
  type: "object",
  required: ["field", "op"],
  additionalProperties: false,
  properties: {
    field: { type: "string", enum: ALL_FIELDS },
    op: { type: "string", enum: ["==", "!=", "<", "<=", ">", ">="] },
    value: { type: ["number", "string", "boolean"] },
    ref: { type: "string", enum: ALL_FIELDS },
    times: { type: "number" },
  },
};

const mission = {
  type: "object",
  required: ["id", "version", "cycle", "title", "when", "goal", "reward"],
  additionalProperties: false,
  properties: {
    id,
    version,
    cycle: { type: "string", enum: ["daily", "weekly", "season"] },
    game: { type: ["string", "null"] },
    title: text,
    when: { type: "string", enum: EVENT_TYPES },
    where: { type: "array", items: condition },
    goal: {
      type: "object",
      additionalProperties: false,
      properties: {
        count: positive,
        sum: { type: "string", enum: ALL_FIELDS },
        distinct: { type: "string", enum: ["game"] },
        target: positive,
      },
    },
    reward: { ...rewards, minItems: 1 },
  },
};

const firstTime = {
  type: "object",
  required: ["id", "version", "title", "when", "reward"],
  additionalProperties: false,
  properties: {
    id,
    version,
    title: text,
    when: { type: "string", enum: EVENT_TYPES },
    game: { type: ["string", "null"] },
    where: { type: "array", items: condition },
    reward: { ...rewards, minItems: 1 },
  },
};

const clock = {
  type: "object",
  required: ["id", "period", "resets", "accumulates", "expires"],
  additionalProperties: false,
  properties: {
    id,
    period: { type: "string", enum: ["daily", "weekly", "season"] },
    resets: { type: "array", items: { type: "string" } },
    accumulates: { type: "array", items: { type: "string" } },
    expires: { type: "array", items: { type: "string" } },
  },
};

const RARITIES = ["comum", "rara", "epica", "lendaria"];

export const SECTION_SCHEMAS = Object.freeze({
  series: {
    type: "object",
    required: ["id", "name", "games"],
    additionalProperties: false,
    properties: {
      id,
      name: text,
      games: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "name", "event"],
          additionalProperties: false,
          properties: {
            id,
            name: text,
            event: { type: "string", enum: ["match.finished", "level.won"] },
            players: positive,
            waves: { type: "boolean" },
            color: { type: "string" },
            art: { type: "string" },
          },
        },
      },
    },
  },
  currencies: {
    type: "array",
    minItems: 1,
    items: {
      type: "object",
      required: ["id", "version", "name", "earned", "purchasable"],
      additionalProperties: false,
      properties: {
        id,
        version,
        name: text,
        earned: { type: "boolean" },
        purchasable: { type: "boolean" },
        expiresWith: { type: ["string", "null"], enum: ["season", "weekly", null] },
        dailyCap: { type: ["integer", "null"], minimum: 1 },
        icon: { type: "string" },
      },
    },
  },
  clocks: {
    type: "object",
    required: ["resetHourUtc", "weekStartsOn", "list"],
    additionalProperties: false,
    properties: {
      resetHourUtc: { type: "integer", minimum: 0, maximum: 23 },
      weekStartsOn: { type: "integer", minimum: 0, maximum: 6 },
      list: { type: "array", minItems: 1, items: clock },
    },
  },
  season: {
    type: "object",
    required: ["id", "version", "name", "validFrom", "validTo", "endWarningDays"],
    additionalProperties: false,
    properties: { id, version, name: text, validFrom: dateTime, validTo: dateTime, endWarningDays: count },
  },
  pass: {
    type: "object",
    required: ["id", "version", "season", "tiers", "premium", "xp"],
    additionalProperties: false,
    properties: {
      id,
      version,
      season: id,
      name: text,
      tracks: {
        type: "object",
        additionalProperties: false,
        properties: { free: text, premium: text },
      },
      tiers: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["xp", "free", "premium"],
          additionalProperties: false,
          properties: { xp: positive, free: rewards, premium: rewards },
        },
      },
      premium: {
        type: "object",
        required: ["price"],
        additionalProperties: false,
        properties: { price },
      },
      xp: {
        type: "object",
        required: ["match", "level", "dailyCap", "idle"],
        additionalProperties: false,
        properties: {
          match: {
            type: "object",
            required: ["base", "cap"],
            additionalProperties: false,
            properties: { base: count, topHalf: count, podium: count, win: count, cap: positive },
          },
          level: {
            type: "object",
            required: ["base", "cap"],
            additionalProperties: false,
            properties: { base: count, perStar: count, cap: positive },
          },
          dailyCap: { type: ["integer", "null"], minimum: 1 },
          idle: {
            type: "object",
            required: ["minDurationS"],
            additionalProperties: false,
            properties: { minDurationS: count },
          },
        },
      },
      tokens: {
        type: "object",
        required: ["xpPerToken"],
        additionalProperties: false,
        properties: { xpPerToken: positive },
      },
    },
  },
  rewards: {
    type: "object",
    required: ["currency"],
    additionalProperties: false,
    properties: {
      currency: id,
      match: {
        type: "object",
        required: ["base"],
        additionalProperties: false,
        properties: { base: count, topHalf: count, podium: count, win: count },
      },
      level: {
        type: "object",
        required: ["base"],
        additionalProperties: false,
        properties: { base: count, perStar: count },
      },
    },
  },
  missions: {
    type: "object",
    required: ["daily", "pool"],
    additionalProperties: false,
    properties: {
      daily: {
        type: "object",
        required: ["slots", "freeRerolls"],
        additionalProperties: false,
        properties: { slots: positive, freeRerolls: { type: "integer", minimum: 0, maximum: 1 } },
      },
      weekly: {
        type: "object",
        required: ["slots"],
        additionalProperties: false,
        properties: { slots: count },
      },
      pool: { type: "array", minItems: 1, items: mission },
    },
  },
  firstTime: { type: "array", items: firstTime },
  cosmetics: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "version", "character", "name", "kind", "rarity", "origin", "duplicate"],
      additionalProperties: false,
      properties: {
        id,
        version,
        character: id,
        name: text,
        kind: { type: "string", enum: ["visual", "retrato"] },
        rarity: { type: "string", enum: RARITIES },
        origin: { type: "string", enum: ["inicio", "passe", "loja", "evento", "conquista", "cofre"] },
        season: id,
        art: { type: "string" },
        validFrom: dateTime,
        validTo: dateTime,
        duplicate: { ...rewards, minItems: 1 },
      },
    },
  },
  store: {
    type: "object",
    required: ["currency", "prices", "rotation"],
    additionalProperties: false,
    properties: {
      currency: id,
      prices: {
        type: "object",
        required: RARITIES,
        additionalProperties: false,
        properties: Object.fromEntries(RARITIES.map((rarity) => [rarity, positive])),
      },
      rotation: {
        type: "object",
        required: ["slots", "pool"],
        additionalProperties: false,
        properties: { slots: positive, pool: { type: "array", minItems: 1, items: id } },
      },
      vault: {
        type: "object",
        required: ["returnsAfterDays", "pool"],
        additionalProperties: false,
        properties: { returnsAfterDays: count, pool: { type: "array", items: id } },
      },
      starter: { type: "array", items: id },
    },
  },
  offers: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "version", "title", "validFrom", "validTo", "price", "grants", "limit"],
      additionalProperties: false,
      properties: {
        id,
        version,
        title: text,
        validFrom: dateTime,
        validTo: dateTime,
        price,
        grants: { ...rewards, minItems: 1 },
        limit: positive,
      },
    },
  },
  dampers: {
    type: "object",
    additionalProperties: false,
    properties: {
      consolation: {
        type: "object",
        required: ["afterLosses", "perDay", "reward", "suggest"],
        additionalProperties: false,
        properties: {
          afterLosses: positive,
          perDay: positive,
          reward: { ...rewards, minItems: 1 },
          suggest: { type: "string", enum: ["none", "easier_match"] },
        },
      },
      trail: {
        type: "object",
        required: ["id", "name", "thresholds", "points", "protection"],
        additionalProperties: false,
        properties: {
          id,
          name: text,
          thresholds: { type: "array", minItems: 2, items: count },
          points: {
            type: "object",
            required: ["played", "topHalf", "podium", "win", "loss"],
            additionalProperties: false,
            properties: {
              played: count,
              topHalf: count,
              podium: count,
              win: count,
              loss: { type: "integer", maximum: 0 },
            },
          },
          protection: {
            type: "object",
            required: ["maxLossPerMatch", "tierBuffer"],
            additionalProperties: false,
            properties: { maxLossPerMatch: count, tierBuffer: count },
          },
        },
      },
    },
  },
  luck: {
    type: "object",
    required: ["enabled", "tables"],
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      tables: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "version", "name", "currency", "cost", "odds", "pity"],
          additionalProperties: false,
          properties: {
            id,
            version,
            name: text,
            currency: id,
            cost: positive,
            odds: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["p"],
                additionalProperties: false,
                properties: {
                  p: { type: "number", exclusiveMinimum: 0, maximum: 1 },
                  item: id,
                  currency: id,
                  amount: positive,
                },
              },
            },
            pity: {
              type: "object",
              required: ["after", "pool"],
              additionalProperties: false,
              properties: { after: positive, pool: { type: "array", minItems: 1, items: id } },
            },
          },
        },
      },
    },
  },
  safety: {
    type: "object",
    required: ["adultAge", "childBelow", "trustSelfDeclaredAdult", "minorNeedsGuardian", "minorMonthlyLimitCents", "luckForMinors", "paidLuck"],
    additionalProperties: false,
    properties: {
      adultAge: positive,
      childBelow: positive,
      trustSelfDeclaredAdult: { type: "boolean" },
      minorNeedsGuardian: { type: "boolean" },
      minorMonthlyLimitCents: count,
      luckForMinors: {
        const: false,
        constMessage: "sorte para menor é recusada; o framework não liga isso (ECA Digital, art. 20)",
      },
      paidLuck: {
        const: false,
        constMessage: "sorte paga é recusada; sorte só com moeda ganha (ECA Digital, art. 20)",
      },
    },
  },
  realPurchase: {
    type: "object",
    required: ["enabled", "products"],
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      products: {
        type: "array",
        items: {
          type: "object",
          required: ["id", "version", "name", "priceCents", "grants"],
          additionalProperties: false,
          properties: {
            id,
            version,
            name: text,
            priceCents: positive,
            grants: { type: "string", enum: ["pass.premium"] },
          },
        },
      },
    },
  },
  experiments: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "version", "startsAt", "endsAt", "target", "variants"],
      additionalProperties: false,
      properties: {
        id,
        version,
        title: text,
        startsAt: dateTime,
        endsAt: dateTime,
        target: {
          type: "string",
          enum: ["ui"],
          enumMessage: "teste A/B só de interface; preço, chance e recompensa não entram em teste",
        },
        variants: { type: "array", minItems: 2, items: id },
      },
    },
  },
});

export const REQUIRED_SECTIONS = Object.freeze([
  "series", "currencies", "clocks", "season", "pass", "rewards", "missions", "cosmetics", "store", "safety",
]);

export const CATALOG_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://alanstudio.local/schemas/gamification-catalog.schema.json",
  title: "Catálogo de gamificação do estúdio",
  type: "object",
  required: ["format", "id", "version", "sections"],
  additionalProperties: false,
  properties: {
    $schema: { type: "string" },
    format: { const: FORMAT },
    id,
    version,
    title: text,
    hash: { type: "string", pattern: "^[0-9a-f]{16}$" },
    sections: {
      type: "object",
      required: REQUIRED_SECTIONS,
      additionalProperties: false,
      properties: SECTION_SCHEMAS,
    },
  },
});
