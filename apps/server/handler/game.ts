// Comandos dentro de una partida. Casi todos: si es el turno del jugador (y no está bloqueado), se
// actualiza su avatar y el mensaje se reenvía tal cual a los demás (sendPacketE).
import Utils = require("../helpers/utils.js");
import type GameClient = require("../client/client.game.js");
import type WOL = require("../wol");
import type { GameMessage } from "wildones-protocol";
import log = require("../helpers/log.js");

type Msg<C> = Extract<GameMessage, { command: C }>;

function isCurrentPlayer(client: GameClient): boolean {
  return client.getGame().currentPlayer == client.player.id;
}

// ¿Puede actuar? Es su turno y su avatar no está bloqueado (tras disparar dos veces)
function canAct(client: GameClient): boolean {
  return isCurrentPlayer(client) && !client.avatar.locked;
}

export function handleChat(client: GameClient, data: Msg<"chat">): void {
  //anti-spam protection
  client.getGame().sendPacketE(data, client);
  client.lastMessageTime = Date.now();
}

export function handleOnReady(client: GameClient): void {
  client.getGame().updatePlayerStatus(client.player.id, "ready");
  log.debug({ status: client.player.status }, "Estado del jugador");
  client.getGame().checkGame();
}

export function handleSynchCheck(client: GameClient, data: Msg<"synch_check">): void {
  if (client.getGame().currentPlayer != client.player.id) return;
  client.getGame().lastSynchCheck = data;
  client.getGame().lastSynchTick = data.tick;
}

export function handleMoveLeft(client: GameClient, data: Msg<"move_left">): void {
  if (!canAct(client)) return;

  client.avatar.isFacingRight = false;
  client.avatar.isWalkingLeft = true;
  client.avatar.isWalkingRight = false;
  client.avatar.setPosition(data.d[0], data.d[1]);
  client.getGame().sendPacketE(data, client);
}

export function handleMoveRight(client: GameClient, data: Msg<"move_right">): void {
  if (!canAct(client)) return;

  client.avatar.isFacingRight = true;
  client.avatar.isWalkingLeft = false;
  client.avatar.isWalkingRight = true;
  client.avatar.setPosition(data.d[0], data.d[1]);
  client.getGame().sendPacketE(data, client);
}

export function handleMoveJump(client: GameClient, data: Msg<"move_jump">): void {
  if (!canAct(client)) return;

  client.avatar.jumpDirection = data.direction;
  client.avatar.waitingForJump = true;
  client.avatar.waitingForJumpTick = client.getGame().tick; //what tick?
  client.avatar.setPosition(data.d[0], data.d[1]);
  client.getGame().sendPacketE(data, client);
}

export function handleMoveStop(client: GameClient, data: Msg<"move_stop">): void {
  if (!canAct(client)) return;

  client.avatar.isWalkingLeft = false;
  client.avatar.isWalkingRight = false;
  client.avatar.setPosition(data.d[0], data.d[1]);
  client.getGame().sendPacketE(data, client);
}

// El jugador en turno da su turno por terminado: el cambio llega en el siguiente tick.
// setNextTurnFN solo acorta el turno; se usa 1 y no 0 porque turnEndTick = 0 significa "sin turno".
export function handleTurnComplete(client: GameClient): void {
  if (!canAct(client)) return;
  client.getGame().setNextTurnFN(1);
}

// Arma un mensaje "position" pero no lo envía (el envío está comentado en el original)
export function handlePosition(client: GameClient, data: Msg<"position">): void {
  const cmd: Record<string, unknown> = {};
  cmd["command"] = "position";
  cmd["x"] = data.x;
  cmd["y"] = data.y;
  cmd["tick"] = data.tick;
  cmd["id"] = client.player.id;
}

export function handleSetAim(client: GameClient, data: Msg<"set_aim">): void {
  if (!canAct(client)) return;

  client.avatar.trueGunAngle = Number(data.value);
  client.avatar.fpDistance = Number(data.power);

  client.getGame().sendPacketE(data, client);
}

export function handleStartFire(client: GameClient, data: Msg<"start_fire">): void {
  if (!canAct(client)) return;
  client.avatar.setPosition(data.d[0], data.d[1]);
  client.getGame().sendPacketE(data, client);
}

// cancel_fire, equip, toggle_weapon, retract_rope, release_rope, stop_rope, detach, teleport_stop:
// solo se reenvían si es el turno del jugador
export function handleRelay(client: GameClient, data: GameMessage): void {
  if (!canAct(client)) return;

  client.getGame().sendPacketE(data, client);
}

export function handleProjectile(client: GameClient, data: Msg<"projectile">, wol: WOL): void {
  //do I own this?
  //is it equipped?
  //did I already shoot?
  //how many remaining uses?
  //should I shorten turn time?
  if (client.getGame().currentPlayer != client.player.id) {
    return;
  }

  // Segundo disparo en el mismo turno: se bloquea al avatar y se ignora
  if (client.avatar.alreadyShot) {
    client.avatar.locked = true;
    return;
  }

  client.avatar.setPosition(data.d[0], data.d[1]);

  const properties = wol.weaponsObj[data.ammo_type];

  if (!properties) return;

  // (en el original hay una validación comentada de si el jugador tiene el arma)
  if (properties.timeAfter == null) {
    //harmful
    client.avatar.alreadyShot = true;
    log.debug({ ticks: wol.DEFAULT_TIME_AFTER_WEAPON }, "Fin de turno tras disparo (tiempo por defecto)");
    client.getGame().setNextTurnFN(wol.DEFAULT_TIME_AFTER_WEAPON);
  } else if (properties.timeAfter > 0) {
    //harmful
    client.avatar.alreadyShot = true;
    log.debug({ ticks: properties.timeAfter / 10 }, "Fin de turno tras disparo");
    client.getGame().setNextTurnFN(properties.timeAfter / 10);

    client.addXP(Math.round(Math.random() * 10) + 1);
    client.addGold(Math.round(Math.random() * 5) + 1, true);
  }

  // bug: si no tiene el arma, undefined - 1 = NaN (ver docs/BUGS.md)
  if (data.crate != "true") client.player.userWeaponsOwned[data.ammo_type] -= 1;

  client.updatePlayerData();
  client.sendUpdate();

  client.getGame().sendPacketE(data, client);
}

// Sin enrutar en el original (nadie la llama)
export function handlePlayerKill(client: GameClient, data: { id: number | string }): void {
  log.debug({ id: client.player.id }, "kill");

  if (client.player.id == data.id) {
    client.getGame().setPlayerDead(data.id);
  }

  //handle this
}

// Sin enrutar en el original (nadie la llama)
export function handleRequestSynch(client: GameClient, data: { pid: number | string }): void {
  log.debug({ pid: data.pid }, "request_synch");
  // @ts-expect-error bug: getSynchCommand no existe (ver docs/BUGS.md)
  client.sendPacket(client.getGame().clients[data.pid].getSynchCommand());
}

// El original convertía el mensaje en "adjust_pts", pero el envío está comentado: no tiene efecto
export function handleSynchPts(_client: GameClient, data: Msg<"synch_pts">): void {
  const value = Utils.stringToInt(data.value);
  if (value <= 0) return;
  //client.getGame().sendPacketE(data, client);
}

export function handleLogProjectile(client: GameClient, data: Msg<"log_projectile">): void {
  log.debug({ weapon: data.weapon, x: data.x, y: data.y, vx: data.vx, vy: data.vy }, "Trayectoria de proyectil");
}

// Respuesta a "synchronization": se convierte en "set_synch" con datos del servidor y se manda a todos
// Las muertes (hp 0) solo cuentan si las reporta el jugador en turno
export function handleSynch(client: GameClient, data: Msg<"synchronization">): void {
  const synch = Object.assign(data, { command: "set_synch", id: "oppenheimer", gameRecord: null });
  synch.timeLoop.activeAvatar = client.getGame().currentPlayer;
  synch.timeLoop.currentTick = client.getGame().tick;
  synch.timeLoop.commandQueue = [];

  for (const avatar of synch.avatarList) {
    avatar.isWalkingLeft = "false";
    avatar.isWalkingRight = "false";

    const hp = Utils.stringToInt(avatar.hp);
    const player = avatar.player as string;

    if (hp == 0 && client.getGame().clients[player] && !client.getGame().clients[player].isDead()) {
      if (!isCurrentPlayer(client)) {
        log.warn({ from: client.player.id, id: player }, "Muerte ignorada: no la reporta el jugador en turno");
        continue;
      }
      client.getGame().setPlayerDead(player);
      log.debug({ id: player }, "Jugador muerto tras synchronization");
    }
  }

  client.getGame().sendPacket(synch);
}

// Solo cuenta si lo reporta el jugador en turno (mitigación: el árbitro real sería el servidor simulando,
// ver docs/SIMULACION.md)
export function handlePlayerDied(client: GameClient, data: Msg<"player_died">): void {
  if (!isCurrentPlayer(client)) {
    log.warn({ from: client.player.id, id: data.id }, "Muerte ignorada: no la reporta el jugador en turno");
    return;
  }
  client.getGame().setPlayerDead(parseInt(String(data.id)));
}

export function handleExiting(client: GameClient, data: Msg<"exiting">): void {
  client.getGame().sendPacketE(data, client);
}
