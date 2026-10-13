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

// Chat de la partida. Se reenvían solo los campos que usa el cliente (los pone Controls.finishCommand); el id y
// el nombre salen del servidor (nadie puede hablar por otro). Máximo 200 caracteres y 1 mensaje por segundo
const CHAT_MAX_LENGTH = 200;
const CHAT_INTERVAL_MS = 1000;

export function handleChat(client: GameClient, data: Msg<"chat">): void {
  const raw = data as Record<string, unknown>;
  if (typeof raw.text !== "string" || !raw.text.trim()) return;
  if (Date.now() - client.lastChatTime < CHAT_INTERVAL_MS) return;
  client.lastChatTime = Date.now();

  client.getGame().sendPacketE(
    {
      command: "chat",
      text: raw.text.slice(0, CHAT_MAX_LENGTH),
      id: client.player.id,
      dname: client.player.dname,
      ordered: raw.ordered,
      date: raw.date,
      tick: raw.tick,
    },
    client,
  );
}

export function handleOnReady(client: GameClient): void {
  client.getGame().updatePlayerStatus(client.player.id, "ready");
  log.debug({ status: client.player.status }, "Estado del jugador");
  client.getGame().checkGame();
}

// Quita el "listo". En una sala privada que ya contaba para empezar, la cuenta atrás se detiene
export function handleNotReady(client: GameClient): void {
  const game = client.getGame();
  game.updatePlayerStatus(client.player.id, "waiting");
  if (game.isPrivate && game.isStarting()) game.stopGameStart();
}

// El jugador en turno lo manda cada 50 ticks con un hash de su física. Se reenvía en cuanto llega y con SU tick:
// el cliente es lockstep y quien no está en turno solo avanza hasta el tick del último comando recibido, así que
// esto es su reloj (antes se reenviaba cada 50 ticks del servidor con el tick del servidor; ver docs/BUGS.md)
export function handleSynchCheck(client: GameClient, data: Msg<"synch_check">): void {
  if (client.getGame().currentPlayer != client.player.id) return;
  client.getGame().sendPacketE(data, client);
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

  // Las gratis (mortar, poderes de mascota) no están en userWeaponsOwned: no gastan munición
  const owned = client.player.userWeaponsOwned;
  if (data.crate != "true" && owned[data.ammo_type] != null) owned[data.ammo_type] -= 1;

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

// Cada cliente lo manda con su vida nueva al recibir daño (codificada, ver Utils.stringToInt). Lo que bajó se le
// acredita a quien tiene el turno, si no es él mismo, para los premios de fin de partida. (El original lo
// convertía en "adjust_pts", pero el envío está comentado.)
export function handleSynchPts(client: GameClient, data: Msg<"synch_pts">): void {
  if (String(data.value).length != 16) return;
  const game = client.getGame();
  const mine = game.stats[client.player.id];
  if (!mine) return;
  const hp = Math.max(0, Utils.stringToInt(data.value));
  const damage = mine.hp - hp;
  mine.hp = hp;
  const attacker = game.stats[game.currentPlayer];
  if (damage > 0 && attacker && game.currentPlayer != client.player.id) attacker.damage += damage;
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
