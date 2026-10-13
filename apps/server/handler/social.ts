// Conexión social (frontend web): invitaciones a partida entre amigos.
// 1. A invita a B (invite): tienen que ser amigos; B en el lobby del juego y A en el lobby o esperando en su
//    sala privada.
// 2. B responde (invite_answer). Si acepta y A está en su sala, B entra a esa sala; si no, se crea una sala
//    privada para los dos. Al SWF le llega "join", como en partida rápida: el juego lo lleva solo a la sala.
// Las invitaciones viven en memoria (wol.invites) y caducan en 1 minuto.
// Cada mensaje del servidor lleva { ok, code, message } y los errores además `error` (un id fijo), como el backend
// de cuentas. Los errores salen con command "error".
import type SocialClient = require("../client/client.social.js");
import type WOL = require("../wol");
import type Slot = require("../slot");
import type {
  SocialErrorId,
  SocialFailure,
  SocialMessage,
  SocialServerMessage,
  SocialSuccess,
  PlayerRef,
} from "wildones-protocol";
import { verifyToken } from "./auth";
import log = require("../helpers/log.js");

type Msg<C> = Extract<SocialMessage, { command: C }>;

const INVITE_MS = 60_000;

const ok = (message: string): SocialSuccess => ({ ok: true, code: 200, message });
export const failure = (code: number, error: SocialErrorId, message: string) => ({
  command: "error" as const,
  ...({ ok: false, code, message, error } satisfies SocialFailure),
});

export function handleSocialLogin(client: SocialClient, data: Msg<"logIn">): void {
  const id = verifyToken(data.token ?? "");
  if (id === null) {
    return client.sendPacket(failure(401, "SESSION_EXPIRED", "Tu sesión expiró, vuelve a entrar"));
  }
  client.db.fetch({ id }, function (doc) {
    if (!doc) return client.sendPacket(failure(404, "PLAYER_NOT_FOUND", "Tu jugador no existe"));
    client.player = { id: doc.id, dname: doc.dname };
    client.sendPacket({ command: "social_ready", ...ok("Conectado") });
  });
}

export function handleInvite(client: SocialClient, data: Msg<"invite">, wol: WOL): void {
  const fail = (code: number, error: SocialErrorId, message: string) =>
    client.sendPacket(failure(code, error, message));
  const me = client.player;
  if (!me) return fail(401, "LOGIN_REQUIRED", "Primero entra con tu sesión");

  const friendLobby = wol.lobbyClientOf(data.to);
  const myRoom = wol.slotOf(me.id);
  if (!wol.lobbyClientOf(me.id) || (myRoom && !isWaitingRoom(myRoom))) {
    return fail(409, "NOT_IN_LOBBY", "Para invitar, entra al lobby o a tu sala privada");
  }
  if (!friendLobby || wol.isPlaying(data.to) || wol.socialClientsOf(data.to).length == 0) {
    return fail(409, "FRIEND_NOT_IN_LOBBY", "Tu amigo no está en el lobby");
  }

  client.db.areFriends(me.id, data.to, function (friends) {
    if (!friends) return fail(403, "NOT_FRIENDS", "Solo puedes invitar a tus amigos");
    wol.invites[data.to] = { from: me.id, at: Date.now() }; // una por invitado: la nueva reemplaza a la anterior
    sendTo(wol, data.to, {
      command: "invite",
      from: me,
      ...ok(`${me.dname} te invitó a una partida`),
    });
    const to = { id: data.to, dname: friendLobby.player.dname };
    client.sendPacket({ command: "invite_sent", to, ...ok(`Invitación enviada a ${to.dname}`) });
    log.info({ from: me.dname, to: friendLobby.player.dname }, "Invitación a partida");
  });
}

export function handleInviteAnswer(
  client: SocialClient,
  data: Msg<"invite_answer">,
  wol: WOL,
): void {
  const fail = (code: number, error: SocialErrorId, message: string) =>
    client.sendPacket(failure(code, error, message));
  const me = client.player;
  if (!me) return fail(401, "LOGIN_REQUIRED", "Primero entra con tu sesión");

  const invite = wol.invites[me.id];
  if (!invite || invite.from != data.from || Date.now() - invite.at > INVITE_MS) {
    return fail(404, "INVITE_NOT_FOUND", "La invitación ya no es válida");
  }
  delete wol.invites[me.id];

  if (!data.accept) {
    const declined = ok(`${me.dname} no puede jugar ahora`);
    return sendTo(wol, data.from, { command: "invite_declined", by: me, ...declined });
  }

  const hostLobby = wol.lobbyClientOf(data.from);
  const myLobby = wol.lobbyClientOf(me.id);
  if (!hostLobby || !myLobby || wol.isPlaying(me.id)) {
    return fail(409, "NOT_IN_LOBBY", "Ya no estás en el lobby");
  }

  // Quien invitó está esperando en su sala privada: entras a esa
  const hostRoom = wol.slotOf(data.from);
  if (hostRoom) {
    if (!isWaitingRoom(hostRoom)) return fail(409, "GAME_STARTED", "La partida ya empezó");
    if (hostRoom.getPlayerCount() >= hostRoom.playerCount) {
      return fail(409, "ROOM_FULL", "La sala está llena");
    }
    myLobby.gameId = hostRoom.gameId;
    myLobby.sendJoinGame();
    sendTo(wol, data.from, accepted(me));
    log.info({ gameId: hostRoom.gameId }, "Invitación aceptada: entra a la sala");
    return;
  }

  // Si no, sala privada de 2 para los dos (las demás opciones, al azar entre las permitidas). El nombre solo
  // lleva letras, números y guiones, como las salas creadas desde el juego
  const details = wol.validateMapDetails(hostLobby, { playerCount: 2 });
  const gameId = wol.findSlot(hostLobby, details, `invitacion-${data.from}-${me.id}-${Date.now()}`);
  if (!gameId) return fail(500, "SERVER_ERROR", "No se pudo crear la sala");

  for (const lobby of [hostLobby, myLobby]) {
    lobby.gameId = gameId;
    lobby.sendJoinGame();
  }
  sendTo(wol, data.from, accepted(me));
  log.info({ gameId }, "Invitación aceptada: sala creada");
}

// A quien invitó: aceptaron y los dos van a la sala
function accepted(by: PlayerRef): SocialServerMessage {
  return { command: "invite_accepted", by, ...ok(`${by.dname} aceptó: entrando a la sala`) };
}

// Sala privada que todavía no empieza (se puede invitar a ella)
function isWaitingRoom(slot: Slot): boolean {
  return slot.isPrivate && !slot.isRunning() && !slot.isGameOver();
}

// A todas las pestañas del frontend de ese jugador
function sendTo(wol: WOL, id: number, packet: SocialServerMessage): void {
  for (const social of wol.socialClientsOf(id)) social.sendPacket(packet);
}
