// Conexión social (frontend web): invitaciones a partida entre amigos.
// 1. A invita a B (invite): tienen que ser amigos y estar los dos en el lobby del juego.
// 2. B responde (invite_answer). Si acepta, se crea una sala privada y a los dos SWF les llega "join",
//    como en partida rápida: el juego los lleva solo a la sala de espera.
// Las invitaciones viven en memoria (wol.invites) y caducan en 1 minuto.
import type SocialClient = require("../client/client.social.js");
import type WOL = require("../wol");
import type { SocialMessage, SocialServerMessage } from "wildones-protocol";
import { verifyToken } from "./auth";
import log = require("../helpers/log.js");

type Msg<C> = Extract<SocialMessage, { command: C }>;

const INVITE_MS = 60_000;

export function handleSocialLogin(client: SocialClient, data: Msg<"logIn">): void {
  const id = verifyToken(data.token ?? "");
  if (id === null) return; // como en el lobby: con un token malo no se responde nada
  client.db.fetch({ id }, function (doc) {
    if (!doc) return;
    client.player = { id: doc.id, dname: doc.dname };
    client.sendPacket({ command: "social_ready" });
  });
}

export function handleInvite(client: SocialClient, data: Msg<"invite">, wol: WOL): void {
  const me = client.player;
  if (!me) return;
  const fail = (error: string) => client.sendPacket({ command: "invite_error", error });

  const friendLobby = wol.lobbyClientOf(data.to);
  if (!wol.lobbyClientOf(me.id) || wol.isPlaying(me.id)) {
    return fail("Entra al lobby del juego para invitar");
  }
  if (!friendLobby || wol.isPlaying(data.to) || wol.socialClientsOf(data.to).length == 0) {
    return fail("Tu amigo no está en el lobby");
  }

  client.db.areFriends(me.id, data.to, function (friends) {
    if (!friends) return fail("Solo puedes invitar a tus amigos");
    wol.invites[data.to] = { from: me.id, at: Date.now() }; // una por invitado: la nueva reemplaza a la anterior
    sendTo(wol, data.to, { command: "invite", from: me });
    client.sendPacket({
      command: "invite_sent",
      to: { id: data.to, dname: friendLobby.player.dname },
    });
    log.info({ from: me.dname, to: friendLobby.player.dname }, "Invitación a partida");
  });
}

export function handleInviteAnswer(
  client: SocialClient,
  data: Msg<"invite_answer">,
  wol: WOL,
): void {
  const me = client.player;
  if (!me) return;
  const fail = (error: string) => client.sendPacket({ command: "invite_error", error });

  const invite = wol.invites[me.id];
  if (!invite || invite.from != data.from || Date.now() - invite.at > INVITE_MS) {
    return fail("La invitación ya no es válida");
  }
  delete wol.invites[me.id];

  if (!data.accept) return sendTo(wol, data.from, { command: "invite_declined", by: me });

  const hostLobby = wol.lobbyClientOf(data.from);
  const myLobby = wol.lobbyClientOf(me.id);
  if (!hostLobby || !myLobby || wol.isPlaying(data.from) || wol.isPlaying(me.id)) {
    return fail("Ya no están los dos en el lobby");
  }

  // Sala privada de 2 (las demás opciones, al azar entre las permitidas). El nombre solo lleva letras,
  // números y guiones, como las salas creadas desde el juego
  const details = wol.validateMapDetails(hostLobby, { playerCount: 2 });
  const gameId = wol.findSlot(hostLobby, details, `invitacion-${data.from}-${me.id}-${Date.now()}`);
  if (!gameId) return fail("No se pudo crear la sala");

  for (const lobby of [hostLobby, myLobby]) {
    lobby.gameId = gameId;
    lobby.sendJoinGame();
  }
  sendTo(wol, data.from, { command: "invite_accepted", by: me });
  log.info({ gameId }, "Invitación aceptada: sala creada");
}

// A todas las pestañas del frontend de ese jugador
function sendTo(wol: WOL, id: number, packet: SocialServerMessage): void {
  for (const social of wol.socialClientsOf(id)) social.sendPacket(packet);
}
