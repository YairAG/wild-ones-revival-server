// Nivel a partir de la XP (helpers/level.ts), con una tabla de niveles inventada.
import { test } from "node:test";
import assert = require("node:assert/strict");
import levelFromXp = require("../helpers/level.js");

// XP mínima de cada nivel: el nivel 1 desde 0, el 2 desde 10, el 3 desde 30 (el último de la tabla, 60)
const levels = [{ xp: 0 }, { xp: 10 }, { xp: 30 }, { xp: 60 }];

test("el nivel es el primero cuya XP mínima supera la tuya", () => {
  assert.equal(levelFromXp(levels, 0), 1);
  assert.equal(levelFromXp(levels, 9), 1);
  assert.equal(levelFromXp(levels, 10), 2);
  assert.equal(levelFromXp(levels, 59), 3);
});

test("pasado el último nivel de la tabla, cada nivel más cuesta 5580 XP", () => {
  assert.equal(levelFromXp(levels, 60), 4);
  assert.equal(levelFromXp(levels, 60 + 5579), 4);
  assert.equal(levelFromXp(levels, 60 + 5580), 5);
});

test("sin tabla de niveles, nivel 0", () => {
  assert.equal(levelFromXp([], 1000), 0);
});
