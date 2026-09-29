// Validador de um subconjunto do JSON Schema, sem dependência.
//
// Cobre o que o catálogo usa: type (inclusive lista), const, enum, required,
// properties, additionalProperties, items, minItems/maxItems, minimum/maximum,
// exclusiveMinimum, minLength, pattern e format "date-time". Cada erro nomeia o
// campo pelo caminho (`sections.pass.tiers[3].xp`), porque "catálogo inválido" sem
// o campo não ajuda ninguém a consertar.

const TYPE_LABEL = {
  object: "objeto",
  array: "lista",
  string: "texto",
  integer: "inteiro",
  number: "número",
  boolean: "booleano",
  null: "nulo",
};

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isType(value, type) {
  switch (type) {
    case "object": return isPlainObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

export function show(value) {
  if (value === undefined) return "nada";
  const text = JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

export function joinPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

export function formatError(error) {
  return `${error.path || "(raiz)"}: ${error.message}`;
}

export function validateSchema(value, schema, path = "") {
  const errors = [];
  walk(value, schema, path, errors);
  return errors;
}

function walk(value, schema, path, errors) {
  if (!schema) return;
  const push = (message) => errors.push({ path, message });

  if (schema.const !== undefined && value !== schema.const) {
    push(schema.constMessage ?? `precisa ser ${show(schema.const)}, veio ${show(value)}`);
    return;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => isType(value, type))) {
      push(`esperado ${types.map((type) => TYPE_LABEL[type] ?? type).join(" ou ")}, veio ${show(value)}`);
      return;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    push(schema.enumMessage ?? `valor ${show(value)} fora do vocabulário (${schema.enum.map(show).join(", ")})`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) push(`precisa ser ≥ ${schema.minimum}, veio ${value}`);
    if (schema.maximum !== undefined && value > schema.maximum) push(`precisa ser ≤ ${schema.maximum}, veio ${value}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      push(`precisa ser > ${schema.exclusiveMinimum}, veio ${value}`);
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) push(`texto curto demais (mínimo ${schema.minLength})`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) push(`${show(value)} não segue o formato ${schema.pattern}`);
    if (schema.format === "date-time" && (!DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) {
      push(`${show(value)} não é data e hora ISO 8601 com fuso (ex.: 2026-10-01T09:00:00Z)`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push(`precisa de pelo menos ${schema.minItems} item(ns), tem ${value.length}`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push(`aceita no máximo ${schema.maxItems} item(ns), tem ${value.length}`);
    if (schema.items) value.forEach((item, index) => walk(item, schema.items, joinPath(path, index), errors));
  }
  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) errors.push({ path: joinPath(path, key), message: "campo obrigatório ausente" });
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (properties[key]) {
        walk(child, properties[key], joinPath(path, key), errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: joinPath(path, key), message: "campo desconhecido" });
      } else if (isPlainObject(schema.additionalProperties)) {
        walk(child, schema.additionalProperties, joinPath(path, key), errors);
      }
    }
  }
}
