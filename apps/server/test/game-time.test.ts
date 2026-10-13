// Límite de tiempo de partida (gameDuration). Test directo de Slot con jugadores simulados: la duración
// mínima es 1 minuto, así que en vez de esperar se adelanta el reloj a mano.
import { test } from "node:test";
import assert = require("node:assert/strict");
import Slot = require("../slot");
import type GameClient = require("../client/client.game.js");

// Jugador simulado: guarda lo que el servidor le manda
function fakeClient(id: number) {
  const client = {
    player: { id, status: "", dname: "J" + id, wins: 0, losses: 0, gamecount: 0 },
    avatar: { dead: false, stopWalking() {} },
    gameSession: "",
    packets: [] as { command: string }[],
    stats: null as unknown,
    isDead: () => client.avatar.dead,
    sendPacket: (p: { command: string }) => client.packets.push(p),
    sendGameStats: (order: unknown) => (client.stats = order),
    sendServerTick() {},
    resetTurnChanges() {},
    addXP() {},
    addGold() {},
    updatePlayerData() {},
  };
  return client;
}

function runningGame(gameDuration: number) {
  const wol = { updatePresence() {}, syncLobbyPlayer() {} }; // servidor simulado: solo lo que usa el fin de partida
  const slot = new Slot(wol as never, "test_0", "Sink or Swim", 4, gameDuration, 10000);
  const clients = [1, 2, 3].map(fakeClient);
  for (const c of clients) slot.addClient(c as unknown as GameClient);
  slot.status = "running";
  slot.turnEndTick = 1_000_000; // que no cambie el turno durante el test
  return { slot, clients };
}

test("al acabarse el tiempo termina la partida: vivos primero (por id), luego los muertos", () => {
  const { slot, clients } = runningGame(60_000); // 1 minuto = 6000 ticks
  slot.setPlayerDead(2);

  slot.tick = 5990;
  slot.checkGame();
  assert.equal(slot.status, "running", "todavía no se acaba el tiempo");

  slot.tick = 6000;
  slot.checkGame();
  assert.deepEqual(clients[0].stats, [1, 3, 2]); // vivos 1 y 3 empatados, luego el muerto 2
  // Empate: los vivos ni ganan ni pierden; el muerto pierde. Todos suman una partida
  assert.deepEqual(
    clients.map((c) => [c.player.wins, c.player.losses, c.player.gamecount]),
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
  );
  assert.ok(clients[0].packets.some((p) => p.command === "endGame"));
  assert.equal(slot.status, "idle"); // la partida se reinicia
});
