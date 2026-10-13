// Cuándo arranca una sala. Partida rápida: con 2. Sala privada (con nombre): cuando se llena, o 30 s después
// de que entró el último jugador. Test directo de Slot con jugadores simulados.
import { test } from "node:test";
import assert = require("node:assert/strict");
import Slot = require("../slot");
import type GameClient = require("../client/client.game.js");

function room(isPrivate: boolean, playerCount: number) {
  const slot = new Slot({} as never, "sala", "Sink or Swim", playerCount, 60_000, 10_000);
  slot.isPrivate = isPrivate;
  for (const id of [1, 2]) {
    slot.addClient({
      player: { id, status: "", dname: "J" + id },
      avatar: {},
      sendPacket() {},
    } as unknown as GameClient);
  }
  slot.checkGame();
  return slot;
}

test("partida rápida: arranca la cuenta atrás en cuanto hay 2", () => {
  const slot = room(false, 4);
  assert.equal(slot.status, "starting");
  slot.stopGameStart();
});

test("sala privada llena: arranca", () => {
  const slot = room(true, 2);
  assert.equal(slot.status, "starting");
  slot.stopGameStart();
});

test("sala privada sin llenar: espera 30 s desde que entró el último", () => {
  const slot = room(true, 4);
  assert.equal(slot.status, "idle", "2 de 4: todavía espera");

  slot.lastJoinAt = Date.now() - 30_000; // como si hubieran pasado 30 s
  slot.checkGame();
  assert.equal(slot.status, "starting");
  slot.stopGameStart();
});
