#!/usr/bin/env node
// Exporta o esquema do catálogo (fonte canônica em src/catalog-schema.js) para
// schemas/catalog.schema.json, que editores usam pelo campo `$schema` do catálogo.
// Um teste confere que o arquivo e o código não divergem.

import { writeFileSync } from "node:fs";
import { CATALOG_SCHEMA } from "../src/catalog-schema.js";

const target = new URL("../schemas/catalog.schema.json", import.meta.url);
writeFileSync(target, `${JSON.stringify(CATALOG_SCHEMA, null, 2)}\n`);
console.log("schemas/catalog.schema.json atualizado");
