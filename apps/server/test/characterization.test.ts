// Tests de caracterización: fijan cómo se comporta el servidor HOY (bugs incluidos), para detectar
// cualquier cambio durante la migración. Ver docs/TESTS.md.
import { describe, test, before, after } from "node:test";
import jwt = require("jsonwebtoken");
import assert = require("node:assert/strict");
import { startTestServer, user, sleep, TRANSPORTS, type TestEnv } from "./helpers/server";
import type { Document } from "mongodb";
import { TestClient, type Message, type Transport } from "./helpers/client";
import Utils = require("../helpers/utils.js");

function suite(transport: Transport) {
  let env: TestEnv;
  const connect = (urlPath: string) => env.connect(urlPath);
  const waitForUser = (dname: string, check: (doc: Document) => boolean) => env.waitForUser(dname, check);

  before(async () => {
    // Ana tiene una clave vieja en su documento: nunca debe salir del servidor
  env = await startTestServer([user(1, "Ana", { snum: "clave-vieja" }), user(2, "Beto")], transport);
  });

  after(() => env?.stop());

  test("responde a la petición de política de Flash", async () => {
    assert.equal(
      await env.raw("<policy-file-request/>"),
      '<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0',
    );
  });

  if (transport === "ws") {
    test("WebSocket con frames binarios (como Ruffle): responde también en binario", async () => {
      const c = new TestClient(env.port, "/ballistic/lobby?session=x", "ws", true);
      await c.connect();
      c.send({ command: "ping" });
      await c.next("ping_ack");
      assert.ok(c.sawHeader);
      assert.equal(c.receivedBinary, true);
      c.close();
    });
  }

  test("ladder solo responde ping", async () => {
    const ladder = await connect("/ballistic/ladder?session=x");
    ladder.send({ command: "ping" });
    await ladder.next("ping_ack");
    assert.ok(ladder.sawHeader, "la primera respuesta lleva la pseudo-cabecera");
  });

  test("login con token inválido no responde nada", async () => {
    const lobby = await connect("/ballistic/lobby?session=x");
    const unsigned = jwt.sign({}, "", { algorithm: "none", subject: "1" });
    const invalid = {
      "otro secreto": env.token(1, {}, "secreto-equivocado"),
      expirado: env.token(1, { expiresIn: -10 }),
      "sin firma (alg none)": unsigned,
      "usuario inexistente": env.token(999),
      "sub no numérico": env.token(1, { subject: "ana" }),
      "no es un JWT": "hola",
    };
    for (const [why, token] of Object.entries(invalid)) {
      lobby.send({ command: "logIn", token });
      await assert.rejects(lobby.next("setPlayer", 300), Error, why);
    }
    assert.ok(env.logs().some((l) => l.msg === "Token inválido" && l.reason === "jwt expired"));
    assert.ok(env.logs().some((l) => l.msg === "Login fallido: el usuario no existe" && l.id === 999));
  });

  test("mensajes inválidos se descartan y se loguean; el servidor sigue respondiendo", async () => {
    const lobby = await connect("/ballistic/lobby?session=x");
    lobby.send({ command: "buy_ammo", ammoType: 5 }); // ammoType debe ser texto y falta ammoCount
    lobby.send({ command: "comando_inventado" });
    lobby.send({ command: "ping" });
    await lobby.next("ping_ack");
    assert.equal(lobby.messages.length, 0);
    const invalid = env.logs().filter((l) => l.msg === "Mensaje inválido descartado");
    assert.ok(invalid.some((l) => l.level === 40 && l.packet.command === "buy_ammo" && l.packet.ammoType === 5));
    assert.ok(invalid.some((l) => l.packet.command === "comando_inventado"));

    // Tokens y claves nunca aparecen en logs estructurados: pino los reemplaza por [Redacted]
    lobby.send({ command: "logIn", token: 5, snum: "secreto" }); // inválido: token debe ser texto
    await lobby.request({ command: "ping" });
    const login = env.logs().find((l) => l.msg === "Mensaje inválido descartado" && l.packet.command === "logIn");
    assert.equal(login?.packet.token, "[Redacted]");
    assert.equal(login?.packet.snum, "[Redacted]");
  });

  test("partida completa: login → quick_play → 2 jugadores → turno → game over", async (t) => {
    const lobbyA = await connect("/ballistic/lobby?session=x");
    const lobbyB = await connect("/ballistic/lobby?session=x");
    let gameA: TestClient, gameB: TestClient, joinA: Message, joinB: Message;

    await t.test("login en lobby devuelve setPlayer y luego player", async () => {
      lobbyA.send({ command: "logIn", token: env.token(1) });
      const setPlayer = await lobbyA.next("setPlayer");
      assert.equal(setPlayer.dname, "Ana");
      assert.equal(setPlayer.id, 1);
      assert.equal(setPlayer.gold, 1000);
      assert.equal(setPlayer.snum, undefined); // aunque el documento en Mongo la tenga
      assert.equal(setPlayer.online, 4); // conexiones lobby abiertas (incluye las de los tests anteriores)
      assert.equal((await lobbyA.next("player")).dname, "Ana");

      // Beto entra como el cliente SWF original: dname + el JWT en snum
      lobbyB.send({ command: "logIn", dname: "Beto", snum: env.token(2) });
      await lobbyB.next("setPlayer");
      await lobbyB.next("player");

      // El log de login guarda id, nombre e IP, nunca el token
      const record = env.logs().find((l) => l.msg === "Login correcto" && l.dname === "Beto");
      assert.equal(record?.id, 2);
      assert.ok(record?.ip);
      assert.equal(record?.token, undefined);

      // Presencia: en el lobby
      await waitForUser("Ana", (u) => u.presence === "lobby");

      // El nivel se guarda calculado desde la XP (Ana tiene 0 XP: nivel 1 con la tabla de test)
      await waitForUser("Ana", (u) => u.level === 1);
    });

    await t.test("ping en lobby", async () => {
      lobbyA.send({ command: "ping" });
      await lobbyA.next("ping_ack");
    });

    await t.test("quick_play empareja a los dos en la misma partida", async () => {
      const details = { mapName: "Sink or Swim", playerCount: 2, gameDuration: 1, turnDuration: 10 };
      lobbyA.send({ command: "quick_play", ...details });
      joinA = await lobbyA.next("join");
      lobbyB.send({ command: "quick_play", ...details });
      joinB = await lobbyB.next("join");

      assert.equal(joinA.id, "Sink-or-Swim_2_60000_10000_0");
      assert.equal(joinB.id, joinA.id);
      assert.equal(joinA.map, "Sink or Swim");
      assert.equal(joinA.status, "idle");
      assert.equal(joinA.playerCount, 0); // todavía nadie entró por la conexión game
      assert.equal(joinA.turnDuration, 10000);
      assert.notEqual(joinA.session, joinB.session);
      assert.match(joinA.session, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/); // UUID v4

      // La session se guarda en Mongo como gkey (la usa start_server_connect)
      await waitForUser("Ana", (u) => u.gkey === joinA.session);
      await waitForUser("Beto", (u) => u.gkey === joinB.session);
    });

    await t.test("entran por la conexión game y arranca la partida", async () => {
      gameA = await connect(`/ballistic/game?gameId=${joinA.id}&session=${joinA.session}`);
      gameA.send({ command: "start_server_connect", userId: "Ana" });
      assert.equal((await gameA.next("player")).dname, "Ana");
      assert.equal((await gameA.next("game")).playerCount, 1);

      gameB = await connect(`/ballistic/game?gameId=${joinB.id}&session=${joinB.session}`);
      gameB.send({ command: "start_server_connect", userId: "Beto" });
      assert.equal((await gameB.next("player")).dname, "Ana"); // primero recibe a los que ya estaban
      assert.equal((await gameB.next("player")).dname, "Beto");
      assert.equal((await gameA.next("player")).dname, "Beto");

      // Con 2 jugadores: cuenta atrás de 5 s → game_join_confirmed → startGame
      await gameA.next("game_join_confirmed", 7000);
      const start = await gameA.next("startGame");
      await gameB.next("startGame");

      assert.deepEqual(start.co, ["1", "2"]);
      assert.equal(start.currentPlayer, 1); // empieza el id más bajo
      assert.equal(start.tick, 0);
      assert.ok(start.randomSeed >= 0 && start.randomSeed < 1000);
      assert.deepEqual(start.positions, [
        { id: 1, x: 100, y: 100 },
        { id: 2, x: 300, y: 100 },
      ]);
      assert.deepEqual(start.playerlist.map((p: Message) => p.dname), ["Ana", "Beto"]);
      await waitForUser("Ana", (u) => u.presence === "playing");

      // El pase es de un solo uso: se borró de Mongo y reusarlo no deja entrar
      await waitForUser("Ana", (u) => u.gkey === null);
      const intruder = await connect(`/ballistic/game?gameId=${joinA.id}&session=${joinA.session}`);
      intruder.send({ command: "start_server_connect", userId: "Ana" });
      await assert.rejects(intruder.next("player", 500));
      assert.ok(env.logs().some((l) => l.msg === "Pase de partida inválido o ya usado" && l.dname === "Ana"));
    });

    await t.test("solo se reenvían las acciones del jugador en turno", async () => {
      gameB.send({ command: "move_left", d: [5, 5] }); // Beto no está en turno: se ignora
      gameA.send({ command: "move_left", d: [10, 20] });

      const move = await gameB.next("move_left");
      assert.deepEqual(move.d, [10, 20]);
      await sleep(200);
      assert.ok(!gameA.messages.some((m) => m.command === "move_left"));
    });

    await t.test("chat, set_aim, on_ready y synchronization", async () => {
      // chat: se reenvía a los demás aunque no sea su turno, solo con los campos del cliente; id y nombre los
      // pone el servidor (aunque mande otros)
      gameB.send({ command: "chat", text: "hola", extra: 1, id: 1, dname: "Ana", tick: 5 });
      assert.deepEqual(await gameA.next("chat"), { command: "chat", text: "hola", id: 2, dname: "Beto", tick: 5 });
      gameB.send({ command: "chat", text: "otra" }); // menos de 1 s después: se ignora
      await sleep(200);
      assert.ok(!gameA.messages.some((m) => m.command === "chat" && m.text === "otra"));

      // synch_check del jugador en turno (Ana): se reenvía en cuanto llega y con SU tick (es el reloj de los
      // demás). El de quien no está en turno se ignora
      gameA.send({ command: "synch_check", synchCheck: "abc", tick: 123 });
      const check = await gameB.next("synch_check", 1000);
      assert.deepEqual([check.synchCheck, check.tick], ["abc", 123]);
      gameB.send({ command: "synch_check", synchCheck: "xyz", tick: 124 });
      await sleep(200);
      assert.ok(!gameA.messages.some((m) => m.command === "synch_check"));

      // set_aim: solo del jugador en turno, reenviado a los demás
      gameA.send({ command: "set_aim", value: 1.2, power: 300 });
      assert.deepEqual(await gameB.next("set_aim"), { command: "set_aim", value: 1.2, power: 300 });
      // el SWF original los manda como texto
      gameA.send({ command: "set_aim", value: "0.8", power: "1001.37" });
      assert.deepEqual(await gameB.next("set_aim"), { command: "set_aim", value: "0.8", power: "1001.37" });

      // on_ready: marca al jugador como "ready" y manda "game" a todos
      gameB.send({ command: "on_ready" });
      const game = await gameA.next("game");
      assert.deepEqual(game.players.find((p: Message) => p.guid === 2), { guid: 2, status: "ready" });

      // synchronization: el servidor lo transforma en set_synch y lo manda a todos (incluido quien lo envió)
      const hp500 = "407F400000000000"; // 500 codificado en hex (ver PROTOCOL.md, números codificados)
      gameA.send({
        command: "synchronization",
        timeLoop: { activeAvatar: 99, currentTick: 99, commandQueue: [1] },
        avatarList: [{ player: 2, hp: hp500, isWalkingLeft: "true" }],
      });
      for (const g of [gameA, gameB]) {
        const synch = await g.next("set_synch");
        assert.equal(synch.id, "oppenheimer");
        assert.equal(synch.gameRecord, null);
        assert.equal(synch.timeLoop.activeAvatar, 1);
        assert.deepEqual(synch.timeLoop.commandQueue, []);
        assert.deepEqual(synch.avatarList, [{ player: 2, hp: hp500, isWalkingLeft: "false", isWalkingRight: "false" }]);
      }
    });

    await t.test("disparar acorta el turno y pasa al siguiente jugador", async () => {
      // un arma que no tiene (granada, sin munición): no se reenvía
      gameA.send({ command: "projectile", d: [10, 20], ammo_type: "grenade", crate: "false" });
      await sleep(200);
      assert.ok(!gameB.messages.some((m) => m.command === "projectile"));

      gameA.send({ command: "projectile", d: [10, 20], ammo_type: "mortar", crate: "false" });

      const shot = await gameB.next("projectile");
      assert.equal(shot.ammo_type, "mortar");

      // Al que dispara le llegan 3 "player": tras sumar XP (+1..11), tras sumar oro (+1..6) y al final
      const afterXp = await gameA.next("player");
      assert.ok(afterXp.xp >= 1 && afterXp.xp <= 11, "xp " + afterXp.xp);
      assert.equal(afterXp.gold, 1000);
      const afterGold = await gameA.next("player");
      assert.ok(afterGold.gold >= 1001 && afterGold.gold <= 1006, "oro " + afterGold.gold);
      const final = await gameA.next("player");
      assert.equal(final.userWeaponsOwned.mortar, undefined); // es gratis: no se resta munición

      await gameB.next("set_tick"); // va al jugador que empieza turno
      const turnA = await gameA.next("changeTurn");
      await gameB.next("changeTurn");
      assert.equal(turnA.currentPlayer, "2"); // tras el primer cambio el id pasa a ser string
      assert.equal(turnA.why, "Because we can.");
    });

    await t.test("cuando queda uno vivo termina la partida", async () => {
      // Turno de Beto: le baja la vida a Ana de 1000 (la de su perro) a 650 → 350 de daño para Beto
      gameA.send({ command: "synch_pts", value: Utils.intToString(650) });
      await sleep(200);
      gameB.send({ command: "player_died", id: 2 }); // es el turno de Beto: solo cuenta lo que reporta él

      const [statsA, statsB] = [await gameA.next("game_stats"), await gameB.next("game_stats")];
      for (const stats of [statsA, statsB]) assert.deepEqual(stats.players, [1, 2]); // vivo primero
      // Partida de 2: premios a la mitad (helpers/rewards.ts). Ana, primera: solo el lugar
      assert.equal(statsA.place, 1);
      assert.equal(statsA.placeGold, 36);
      assert.equal(statsA.kills, 0);
      // Beto, segundo: su lugar y 3 puntos de daño a la mitad (se eliminó solo: no es eliminación)
      assert.equal(statsB.place, 2);
      assert.equal(statsB.damage, 350);
      assert.equal(statsB.kills, 0);
      assert.deepEqual([statsB.placeGold, statsB.damageGold, statsB.placeXp], [30, 1, 22]);
      assert.ok(statsB.endingXP - statsB.startingXP >= 22 + 1, "la XP ganada incluye los premios");
      for (const g of [gameA, gameB]) await g.next("endGame");
      // Ana (viva) suma una victoria; Beto (muerto), una derrota. Los dos, una partida
      await waitForUser("Ana", (d) => d.wins == 1 && d.losses == 0 && d.gamecount == 1);
      await waitForUser("Beto", (d) => d.wins == 0 && d.losses == 1 && d.gamecount == 1);

      // Presencia: al terminar vuelven al lobby (siguen con esa conexión abierta); al cerrarla, desconectados
      await waitForUser("Ana", (u) => u.presence === "lobby");
      lobbyA.close();
      await waitForUser("Ana", (u) => u.presence === "offline");
    });
  });

  test("un mensaje partido en dos paquetes TCP también se rearma en el lobby", { skip: transport !== "tcp" }, async () => {
    const lobby = await connect("/ballistic/lobby?session=x");
    const ping = '{"command":"ping"}';
    const frame = String(ping.length).padStart(6, "0") + ping;
    lobby.write(frame.slice(0, 10));
    await sleep(100);
    lobby.write(frame.slice(10) + frame); // el resto, y otro ping pegado detrás
    await lobby.next("ping_ack");
    await lobby.next("ping_ack");
  });
}

for (const transport of TRANSPORTS) describe(transport, () => suite(transport));
