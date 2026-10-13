// Lobby: buscar partida (quick_play) y salas con nombre. Responden "join" con el id de la partida y la
// session que el cliente usará para abrir la conexión game.
import type LobbyClient = require("../client/client.lobby.js");
import type WOL = require("../wol");
import type { LobbyMessage } from "wildones-protocol";
import log = require("../helpers/log.js");

type Msg<C> = Extract<LobbyMessage, { command: C }>;

export function handleQuickPlay(client: LobbyClient, packet: Msg<"quick_play">, wol: WOL): void {
  const mapDetails = wol.validateMapDetails(client, packet);
  const gameId = wol.findSlot(client, mapDetails, null);

  log.debug({ gameId }, "Partida encontrada");
  if (gameId == 0) {
    //The map details provided seem to be invalid
    return;
  }

  //send join game only after at least two players are in the slot
  client.gameId = gameId;
  client.sendJoinGame();
}

/*TO DO: move game_name_return to a function */
export function handleGameNameCheck(client: LobbyClient, data: Msg<"game_name_check">, wol: WOL): void {
  if (/^[a-zA-Z0-9- ]*$/.test(data.name) == false) {
    return;
  }

  // Mismo nombre que usará create_game: espacios → guiones
  const cmd = {
    command: "game_name_return",
    name: data.name,
    value: wol.getGame(data.name.split(" ").join("-")) ? 0 : 1,
  };

  client.sendPacket(cmd);
}

export function handleCreateGame(client: LobbyClient, data: Msg<"create_game">, wol: WOL): void {
  if (/^[a-zA-Z0-9- ]*$/.test(data.gameName) == false) {
    return;
  }

  data.gameName = data.gameName.split(" ").join("-");

  if (wol.getGame(data.gameName)) {
    client.sendPacket({
      command: "game_name_return",
      name: data.gameName,
      value: 0,
    });
    return;
  }

  const mapDetails = wol.validateMapDetails(client, data);
  const gameId = wol.findSlot(client, mapDetails, data.gameName);

  if (gameId == 0) {
    //game is running!
    return;
  }

  client.gameId = gameId;
  client.sendJoinGame();
}

export function handleJoinGame(client: LobbyClient, data: Msg<"join_game">, wol: WOL): void {
  if (/^[a-zA-Z0-9- ]*$/.test(data.gameName) == false) {
    return;
  }

  data.gameName = data.gameName.split(" ").join("-");
  const gameRef = wol.getGame(data.gameName);
  if (gameRef) {
    // Solo se le da la llave: entra a la partida con su conexión game (handler/auth.ts)
    if (!gameRef.isRunning()) {
      client.gameId = data.gameName;
      client.sendJoinGame();
    }
  }
}
