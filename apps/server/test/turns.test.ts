// Turnos y muertes: quién puede terminar un turno o reportar una muerte, y cómo se cuentan. Partidas de 3.
import { describe, test, before, after } from "node:test";
import assert = require("node:assert/strict");
import { startTestServer, user, sleep, TRANSPORTS, type TestEnv } from "./helpers/server";
import type { TestClient, Transport } from "./helpers/client";

const PLAYERS = ["Ana", "Beto", "Caro"]; // ids 1, 2 y 3; empieza el id más bajo (Ana)

function suite(transport: Transport) {
  let env: TestEnv;

  before(async () => {
    env = await startTestServer(PLAYERS.map((name, i) => user(i + 1, name)), transport);
  });

  after(() => env?.stop());

  // Login de los 3, quick_play para 4 (así la partida no se llena) y entrada por la conexión game
  async function startGame(): Promise<TestClient[]> {
    const games: TestClient[] = [];
    for (const name of PLAYERS) {
      const lobby = await env.login(name);
      lobby.send({ command: "quick_play", mapName: "Sink or Swim", playerCount: 4, gameDuration: 1, turnDuration: 10 });
      const join = await lobby.next("join");
      await env.waitForUser(name, (u) => u.gkey === join.session);
      const game = await env.connect(`/ballistic/game?gameId=${join.id}&session=${join.session}`);
      game.send({ command: "start_server_connect", userId: name });
      await game.next("player");
      games.push(game);
    }
    for (const game of games) await game.next("startGame", 8000);
    return games;
  }

  test("turn_complete del jugador en turno termina su turno; el de otro se ignora", async () => {
    const [ana, beto] = await startGame(); // turno de Ana (el turno dura 10 s + 2 s)

    beto.send({ command: "turn_complete" }); // no es su turno
    await sleep(500);
    assert.ok(!ana.messages.some((m) => m.command === "changeTurn"));

    ana.send({ command: "turn_complete" });
    const turn = await ana.next("changeTurn", 1000); // llega en el siguiente tick, no a los 12 s
    assert.equal(turn.currentPlayer, "2");
    await beto.next("set_tick"); // al que empieza turno
  });

  test("reportar dos veces la misma muerte cuenta una sola vez", async () => {
    const [ana] = await startGame();

    ana.send({ command: "player_died", id: 3 });
    ana.send({ command: "player_died", id: 3 }); // repetido: antes contaba 2 muertos y terminaba la partida
    await sleep(500);
    assert.ok(!ana.messages.some((m) => m.command === "game_stats"), "la partida no debe terminar con 2 vivos");

    ana.send({ command: "player_died", id: 2 });
    const stats = await ana.next("game_stats");
    assert.deepEqual(stats.players, [1, 2, 3]); // vivo primero, luego los muertos (el último en morir antes)
    // Las dos muertes fueron en su turno: cuentan como eliminaciones suyas. Con 3 jugadores, premios completos
    assert.equal(stats.kills, 2);
    assert.deepEqual([stats.placeGold, stats.killsGold, stats.killsXp], [72, 20, 30]);
  });

  test("solo cuentan las muertes que reporta el jugador en turno", async () => {
    const [ana, beto] = await startGame(); // turno de Ana
    const hp0 = "0000000000000000"; // 0 codificado en hex (ver PROTOCOL.md, números codificados)

    // Beto no está en turno: no puede matar a Ana ni por player_died ni por synchronization
    beto.send({ command: "player_died", id: 1 });
    beto.send({ command: "synchronization", timeLoop: {}, avatarList: [{ player: 1, hp: hp0 }] });
    await beto.next("set_synch"); // el set_synch se reenvía igual, pero sin matar a nadie
    ana.send({ command: "player_died", id: 2 }); // Ana sí: si las de Beto contaran, aquí terminaría la partida
    await sleep(500);
    assert.ok(!ana.messages.some((m) => m.command === "game_stats"), "las muertes de Beto no deben contar");
    const ignored = env.logs().filter((l) => l.msg === "Muerte ignorada: no la reporta el jugador en turno");
    assert.ok(ignored.some((l) => l.from === 2 && l.id === 1));

    // Ana (en turno) mata a Caro por synchronization: queda sola y termina la partida
    ana.send({ command: "synchronization", timeLoop: {}, avatarList: [{ player: 3, hp: hp0 }] });
    const stats = await ana.next("game_stats");
    assert.deepEqual(stats.players, [1, 3, 2]);
  });
}

for (const transport of TRANSPORTS) describe(transport, () => suite(transport));
