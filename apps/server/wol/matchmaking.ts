// Emparejamiento: valida las opciones de partida y busca una partida que acepte jugadores o crea una.
// Id de partida automática: "<mapa con guiones>_<jugadores>_<duración ms>_<turno ms>_<n>"
import type WOL = require("./index.js");
import type Slot = require("../slot");
import type LobbyClient = require("../client/client.lobby.js");
import log = require("../helpers/log.js");

export type MapDetails = { mapName?: string; playerCount?: number; gameDuration?: number; turnDuration?: number };

const pickRandom = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

// Ocupada: ya empezó, terminó o está por empezar
function isOccupied(slot: Slot): boolean {
  return slot.isRunning() || slot.isGameOver() || (slot.startingTime != 0 && slot.startingTime <= Date.now() + 1000);
}

/** Cambia por uno al azar cada valor no permitido por Config, y el mapa inexistente por "Sink or Swim" */
export function validateMapDetails<D extends MapDetails>(wol: WOL, client: LobbyClient, data: D): D {
  if (wol.config.turnTimes.indexOf(data.turnDuration as number) < 0) data.turnDuration = pickRandom(wol.config.turnTimes);

  if (wol.config.gameTimes.indexOf(data.gameDuration as number) < 0) data.gameDuration = pickRandom(wol.config.gameTimes);

  if (wol.config.maxPlayers.indexOf(data.playerCount as number) < 0) data.playerCount = pickRandom(wol.config.maxPlayers);

  if (!wol.mapsObj[data.mapName as string]) {
    // (el original tenía un if por xp > 20557 con las dos ramas iguales)
    data.mapName = wol.mapsObj["Sink or Swim"].name;
  }

  return data;
}

/** Para quien entra a una partida llena: busca la siguiente con las mismas opciones (o la crea) */
export function findSimilarSlot(wol: WOL, map: Slot): string | undefined {
  const mapName = map.gameId;
  const gameNumber = parseInt(mapName.substring(mapName.length - 1));
  const gameId = mapName.substring(0, mapName.length - 1); //without last character

  for (let i = gameNumber + 1; i < wol.config.maxSlots; i++) {
    const tmpId = gameId + i;
    if (wol.slots[tmpId]) {
      if (isOccupied(wol.slots[tmpId])) {
        log.debug({ gameId: tmpId }, "Partida ocupada");
        continue;
      }

      if (wol.slots[tmpId].getPlayerCount() < map.playerCount) {
        return tmpId;
      } else continue;
    } else {
      wol.createSlot(tmpId, map.mapName, map.playerCount, map.gameDuration, map.turnDuration);
      return tmpId;
    }
  }
}

/** Devuelve el id de una partida con lugar (creándola si hace falta), o 0 si las opciones no son válidas */
export function findSlot(wol: WOL, mapDetails: MapDetails, customName: string | null): string | 0 | undefined {
  if (
    // eslint-disable-next-line no-prototype-builtins -- se mantiene el original
    !(mapDetails.hasOwnProperty("mapName") && mapDetails.hasOwnProperty("playerCount") &&
      // eslint-disable-next-line no-prototype-builtins -- se mantiene el original
      mapDetails.hasOwnProperty("gameDuration") && mapDetails.hasOwnProperty("turnDuration"))
  )
    return 0;

  if (!wol.mapsObj[mapDetails.mapName as string]) return 0;
  if (wol.config.gameTimes.indexOf(mapDetails.gameDuration as number) < 0) return 0;
  if (wol.config.turnTimes.indexOf(mapDetails.turnDuration as number) < 0) return 0;
  if (wol.config.maxPlayers.indexOf(mapDetails.playerCount as number) < 0) return 0;

  const mapName = mapDetails.mapName as string;
  const playerCount = parseInt(String(mapDetails.playerCount));
  const gameDuration = parseInt(String(mapDetails.gameDuration)) * 60 * 1000;
  const turnDuration = parseInt(String(mapDetails.turnDuration)) * 1000;
  let gameId: string;
  let tmpId: string | undefined; // en el original era un `var` del bucle de abajo, visible en todo el método

  if (customName) {
    gameId = customName;

    if (wol.slots[gameId]) {
      // bug: usa tmpId (undefined) en vez de gameId, lanza TypeError (ver docs/BUGS.md)
      if (isOccupied(wol.slots[tmpId as string])) {
        return 0;
      }
    } else {
      wol.createSlot(gameId, mapName, playerCount, gameDuration, turnDuration);
      log.debug({ gameId }, "Sala creada");
      return gameId;
    }
  } else {
    gameId = [mapName, playerCount, gameDuration, turnDuration].join("_") + "_";

    gameId = gameId.split(" ").join("-");

    for (let i = 0; i < wol.config.maxSlots; i++) {
      tmpId = gameId + i;
      if (wol.slots[tmpId]) {
        if (isOccupied(wol.slots[tmpId])) {
          log.debug({ gameId: tmpId }, "Partida ocupada");
          continue;
        }

        if (wol.slots[tmpId].getPlayerCount() < playerCount) {
          return tmpId;
        } else continue;
      } else {
        wol.createSlot(tmpId, mapName, playerCount, gameDuration, turnDuration);
        return tmpId;
      }
    }
  }
}
