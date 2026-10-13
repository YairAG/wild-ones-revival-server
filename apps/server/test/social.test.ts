// Conexión social (frontend web): invitaciones a partida entre amigos. Datos inventados.
import { describe, test, before, after } from "node:test";
import assert = require("node:assert/strict");
import { startTestServer, user, TRANSPORTS, type TestEnv } from "./helpers/server";
import type { TestClient, Transport } from "./helpers/client";

// Ana y Beto son amigos; Caro no es amiga de nadie; Dani es amiga de Ana pero no tiene el juego abierto
const USERS = [user(1, "Ana"), user(2, "Beto"), user(3, "Caro"), user(4, "Dani")];

function suite(transport: Transport) {
  let env: TestEnv;
  const lobby: Record<string, TestClient> = {};
  const social: Record<string, TestClient> = {};

  // Abre la conexión social y entra con el token, como el frontend
  async function connectSocial(dname: string) {
    const c = await env.connect("/ballistic/social?x");
    c.send({ command: "logIn", token: env.token(USERS.find((u) => u.dname === dname)!.id) });
    assert.deepEqual(await c.next("social_ready"), {
      command: "social_ready",
      ok: true,
      code: 200,
      message: "Conectado",
    });
    return c;
  }

  before(async () => {
    env = await startTestServer(USERS, transport);
    // Las amistades las escribe el backend de cuentas (colección friendships)
    await env.db.collection("friendships").insertMany([
      { pair: "1-2", from: 1, to: 2, status: "accepted" },
      { pair: "1-4", from: 1, to: 4, status: "accepted" },
    ]);
    for (const dname of ["Ana", "Beto", "Caro"]) lobby[dname] = await env.login(dname);
    for (const dname of ["Ana", "Beto", "Caro", "Dani"]) social[dname] = await connectSocial(dname);
  });
  after(() => env?.stop());

  test("con un token inválido responde SESSION_EXPIRED; sin logIn, LOGIN_REQUIRED", async () => {
    const c = await env.connect("/ballistic/social?x");
    c.send({ command: "invite", to: 2 });
    assert.equal((await c.next("error")).error, "LOGIN_REQUIRED");
    c.send({ command: "logIn", token: "no-es-un-jwt" });
    assert.deepEqual(await c.next("error"), {
      command: "error",
      ok: false,
      code: 401,
      message: "Tu sesión expiró, vuelve a entrar",
      error: "SESSION_EXPIRED",
    });
  });

  test("un mensaje inválido responde INVALID_DATA", async () => {
    social.Ana.send({ command: "invite", to: "Beto" });
    const res = await social.Ana.next("error");
    assert.equal(res.code, 400);
    assert.equal(res.error, "INVALID_DATA");
  });

  test("solo se invita a amigos que estén en el lobby", async () => {
    social.Ana.send({ command: "invite", to: 3 });
    assert.deepEqual(await social.Ana.next("error"), {
      command: "error",
      ok: false,
      code: 403,
      message: "Solo puedes invitar a tus amigos",
      error: "NOT_FRIENDS",
    });

    social.Ana.send({ command: "invite", to: 4 }); // Dani no tiene el lobby abierto
    assert.equal((await social.Ana.next("error")).error, "FRIEND_NOT_IN_LOBBY");
  });

  test("invitar y rechazar", async () => {
    social.Ana.send({ command: "invite", to: 2 });
    const invite = await social.Beto.next("invite");
    assert.deepEqual(invite.from, { id: 1, dname: "Ana" });
    assert.equal(invite.message, "Ana te invitó a una partida");
    const sent = await social.Ana.next("invite_sent");
    assert.deepEqual(sent.to, { id: 2, dname: "Beto" });
    assert.equal(sent.message, "Invitación enviada a Beto");

    social.Beto.send({ command: "invite_answer", from: 1, accept: false });
    const declined = await social.Ana.next("invite_declined");
    assert.deepEqual(declined.by, { id: 2, dname: "Beto" });
    assert.equal(declined.message, "Beto no puede jugar ahora");

    // Ya respondida: no se puede volver a usar
    social.Beto.send({ command: "invite_answer", from: 1, accept: true });
    const expired = await social.Beto.next("error");
    assert.equal(expired.error, "INVITE_NOT_FOUND");
    assert.equal(expired.message, "La invitación ya no es válida");
  });

  test("al aceptar, a los dos SWF les llega join a la misma sala privada", async () => {
    social.Ana.send({ command: "invite", to: 2 });
    await social.Beto.next("invite");
    social.Beto.send({ command: "invite_answer", from: 1, accept: true });

    const joinAna = await lobby.Ana.next("join");
    const joinBeto = await lobby.Beto.next("join");
    assert.equal(joinAna.id, joinBeto.id);
    assert.match(joinAna.id, /^invitacion-1-2-\d+$/);
    assert.notEqual(joinAna.session, joinBeto.session); // cada uno con su pase
    const accepted = await social.Ana.next("invite_accepted");
    assert.deepEqual(accepted.by, { id: 2, dname: "Beto" });
    assert.equal(accepted.message, "Beto aceptó: entrando a la sala");
  });

  test("si quien invita está esperando en su sala privada, el invitado entra a esa sala", async () => {
    // Ana crea su sala desde el juego y entra
    lobby.Ana.send({
      command: "create_game",
      gameName: "SalaDeAna",
      mapName: "Sink or Swim",
      playerCount: 4,
      gameDuration: 4,
      turnDuration: 15,
    });
    const join = await lobby.Ana.next("join");
    const game = await env.connect(`/ballistic/game?gameId=${join.id}&session=${join.session}`);
    game.send({ command: "start_server_connect", userId: "Ana" });
    await game.next("player");

    social.Ana.send({ command: "invite", to: 2 });
    await social.Beto.next("invite");
    social.Beto.send({ command: "invite_answer", from: 1, accept: true });

    assert.equal((await lobby.Beto.next("join")).id, "SalaDeAna");
    assert.deepEqual((await social.Ana.next("invite_accepted")).by, { id: 2, dname: "Beto" });
  });
}

for (const transport of TRANSPORTS) describe(transport, () => suite(transport));
