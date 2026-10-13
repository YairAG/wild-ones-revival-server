// Salas privadas (con nombre): no arrancan hasta que todos están listos. La partida rápida arranca con 2.
// Test directo de Slot con jugadores simulados.
import { test } from "node:test";
import assert = require("node:assert/strict");
import Slot = require("../slot");
import type GameClient = require("../client/client.game.js");
import { handleNotReady, handleOnReady } from "../handler/game";

function fakeClient(id: number, slot: Slot) {
  return {
    player: { id, status: "ready", dname: "J" + id }, // "ready" viejo de Mongo: al entrar se reinicia
    avatar: {},
    gameSession: "",
    getGame: () => slot,
    sendPacket() {},
  } as unknown as GameClient;
}

function roomWithTwo(isPrivate: boolean) {
  const slot = new Slot({} as never, "sala", "Sink or Swim", 4, 60_000, 10_000);
  slot.isPrivate = isPrivate;
  const clients = [1, 2].map((id) => fakeClient(id, slot));
  for (const c of clients) slot.addClient(c);
  slot.checkGame();
  return { slot, clients };
}

test("partida rápida: arranca la cuenta atrás en cuanto hay 2", () => {
  const { slot } = roomWithTwo(false);
  assert.equal(slot.status, "starting");
  slot.stopGameStart();
});

test("sala privada: espera a que todos estén listos", () => {
  const { slot, clients } = roomWithTwo(true);
  assert.equal(slot.status, "idle", "al entrar nadie está listo");

  handleOnReady(clients[0]);
  assert.equal(slot.status, "idle", "falta uno");
  handleOnReady(clients[1]);
  assert.equal(slot.status, "starting");

  // Si alguien quita su listo, la cuenta atrás se detiene
  handleNotReady(clients[1]);
  assert.equal(slot.status, "idle");
});
