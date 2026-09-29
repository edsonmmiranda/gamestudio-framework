// O SHA-256 próprio precisa bater com o do Node em qualquer entrada, e o hash do
// catálogo precisa mudar só na seção que mudou.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { loadBundle } from "../src/catalog.js";
import { canonicalJson, sha256Hex } from "../src/hash.js";
import { mulberry32 } from "../src/rng.js";
import { rawExample } from "./_support.mjs";

const node = (text) => createHash("sha256").update(text, "utf8").digest("hex");

test("propriedade: sha256Hex = node:crypto, inclusive nas bordas de bloco e em unicode", () => {
  const alphabet = "abcXYZ019 ãçéü✎→\u{1F58A}\n\t\"{}";
  const rng = mulberry32(11);
  for (const length of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
    const text = "a".repeat(length);
    assert.equal(sha256Hex(text), node(text), `comprimento ${length}`);
  }
  for (let i = 0; i < 300; i += 1) {
    const length = Math.floor(rng() * 300);
    let text = "";
    const chars = [...alphabet];
    for (let j = 0; j < length; j += 1) text += chars[Math.floor(rng() * chars.length)];
    assert.equal(sha256Hex(text), node(text));
  }
});

test("JSON canônico não depende da ordem das chaves", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test("substituir uma seção muda o hash dela e o do pacote, e só o dela", () => {
  const base = loadBundle(rawExample()).bundle;
  const luck = { ...base.sections.luck, enabled: true };
  const changed = loadBundle(rawExample(), { overrides: { luck } }).bundle;
  assert.notEqual(changed.hash, base.hash);
  assert.deepEqual(changed.overridden, ["luck"]);
  for (const [name, hash] of Object.entries(base.sectionHashes)) {
    if (name === "luck") assert.notEqual(changed.sectionHashes[name], hash);
    else assert.equal(changed.sectionHashes[name], hash, `a seção ${name} não mudou`);
  }
});
