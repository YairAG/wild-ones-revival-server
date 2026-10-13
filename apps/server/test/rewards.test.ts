// Premios de fin de partida (helpers/rewards.ts).
import { test } from "node:test";
import assert = require("node:assert/strict");
import rewards = require("../helpers/rewards.js");

test("3 o más jugadores: por lugar, por eliminación y por cada 100 de daño", () => {
  assert.deepEqual(rewards(0, 2, 850, 3), {
    placeGold: 72, // 12 × (6 − 0)
    placeXp: 54, // 9 × (6 − 0)
    killsGold: 20,
    killsXp: 30,
    damageGold: 8,
    damageXp: 8,
  });
  assert.equal(rewards(2, 0, 0, 4).placeGold, 48);
});

test("2 jugadores: todo a la mitad, redondeado hacia abajo", () => {
  assert.deepEqual(rewards(1, 1, 350, 2), {
    placeGold: 30,
    placeXp: 22,
    killsGold: 5,
    killsXp: 7,
    damageGold: 1,
    damageXp: 1,
  });
});
