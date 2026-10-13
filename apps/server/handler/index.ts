// Recibe los datos de cada socket, separa los mensajes (6 dígitos de longitud + JSON), los valida y los
// manda a la función de su comando. Los comandos están en auth, shop, rooms, game y social (ver docs/PROTOCOL.md).
import LobbyClient = require("../client/client.lobby.js");
import LadderClient = require("../client/client.ladder.js");
import GameClient = require("../client/client.game.js");
import SocialClient = require("../client/client.social.js");
import Protocol = require("wildones-protocol");
import type Client = require("../client/client.abstract.js");
import type WOL = require("../wol");
import * as auth from "./auth";
import * as shop from "./shop";
import * as rooms from "./rooms";
import * as game from "./game";
import * as social from "./social";
import log = require("../helpers/log.js");

type AnyClient = Client | LobbyClient | LadderClient | GameClient | SocialClient;

// Valida un mensaje entrante contra su esquema; los inválidos se loguean y se descartan
type Schema =
  | typeof Protocol.lobbyMessage
  | typeof Protocol.ladderMessage
  | typeof Protocol.gameMessage
  | typeof Protocol.socialMessage;

function isValid(schema: Schema, packet: unknown): boolean {
  const result = schema.safeParse(packet);
  if (!result.success) log.warn({ packet, error: result.error.message }, "Mensaje inválido descartado");
  return result.success;
}

// Un mensaje a medias no puede pasar de esto (el más grande, synchronization, mide unos pocos KB)
const MAX_PENDING_BYTES = 256 * 1024;

class Handler {
  declare WOL: WOL;

  constructor(wol: WOL) {
    log.debug("Handler creado");
    this.WOL = wol;
  }

  //### Packet processing ###

  handle(client: AnyClient, data: Buffer | string): void {
    if (data.indexOf("<policy-file-request/>") >= 0) {
      client.write('<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0');
    } else {
      try {
        this.handleJSON(client, data);
      } catch (e) {
        log.error({ err: e }, "Excepción al procesar datos");
      }
    }
  }

  handleJSON(client: AnyClient, data: Buffer | string): void {
    log.debug({ connectionType: client.connectionType, data: String(data) }, "Datos recibidos");
    if (!data) return;
    let raw = Buffer.from(data); // en bytes: una ñ partida entre dos paquetes no se rompe al convertir a texto
    data = raw.toString();

    let stateObject = client;

    /* INITIALIZE: la primera vez llega "POST /ballistic/<tipo>?... HTTP/1.1" + cabeceras */
    if (data.indexOf("POST") >= 0) {
      const path = data.split(" ")[1];
      const connectionType = path.split("?")[0].split("/")[2];

      client.connectionType = connectionType;

      if (connectionType == "game") {
        const gameClient = new GameClient(client as Client);
        stateObject = gameClient;
        (client as Client).fireChangeEvent();
        gameClient.WOL.addClient(gameClient);
        try {
          const tokens = path.split("?")[1].split("&");
          const gameId = tokens[0].split("=")[1];
          const session = tokens[1].split("=")[1];

          gameClient.gameId = gameId;
          gameClient.gameSession = session;
        } catch {
          //throw e;
        }
      } else if (connectionType == "lobby") {
        stateObject = new LobbyClient(client as Client);
        (client as Client).fireChangeEvent();
        stateObject.WOL.addClient(stateObject);
      } else if (connectionType == "ladder") {
        stateObject = new LadderClient(client as Client);
        (client as Client).fireChangeEvent();
        stateObject.WOL.addClient(stateObject);
      } else if (connectionType == "social") {
        stateObject = new SocialClient(client as Client);
        (client as Client).fireChangeEvent();
        stateObject.WOL.addClient(stateObject);
      }

      raw = raw.subarray(raw.indexOf("\r\n\r\n") + 4); // sin la cabecera HTTP
    }

    if (raw.length == 0 || stateObject.connectionType == "") return;

    // Mensajes: 6 dígitos con la longitud EN BYTES (así la cuenta el SWF) + el JSON. Puede llegar más de uno junto
    // o uno partido en varios paquetes: lo que sobra se guarda hasta que llegue el resto
    let bytes = Buffer.concat([stateObject.pendingBytes, raw]);
    while (bytes.length >= 6) {
      const len = Number(bytes.subarray(0, 6).toString());
      if (!Number.isInteger(len)) {
        log.warn({ data: bytes.toString() }, "Mensaje sin longitud válida descartado");
        bytes = Buffer.alloc(0);
        break;
      }
      if (bytes.length < 6 + len) break; // falta el resto
      this.dispatch(stateObject, bytes.subarray(6, 6 + len).toString());
      bytes = bytes.subarray(6 + len);
    }
    if (bytes.length > MAX_PENDING_BYTES) {
      log.warn({ bytes: bytes.length }, "Mensaje incompleto demasiado grande, descartado");
      bytes = Buffer.alloc(0);
    }
    stateObject.pendingBytes = bytes;
  }

  // Manda un mensaje al handler de su tipo de conexión. Si lanza una excepción solo se pierde ese mensaje (antes
  // se perdía también lo que venía detrás en el mismo paquete TCP)
  dispatch(client: AnyClient, json: string): void {
    try {
      const packet = JSON.parse(json);
      if (client.connectionType == "lobby") this.handleLobbyCommand(client as LobbyClient, packet);
      else if (client.connectionType == "ladder") this.handleLadderCommand(client as LadderClient, packet);
      else if (client.connectionType == "game") this.handleGameCommand(client as GameClient, packet);
      else if (client.connectionType == "social") this.handleSocialCommand(client as SocialClient, packet);
    } catch (e) {
      log.error({ err: e, connectionType: client.connectionType }, "Excepción al procesar un mensaje");
    }
  }

  //### Packet handling ###

  handleLobbyCommand(client: LobbyClient, packet: Protocol.LobbyMessage): void {
    if (!isValid(Protocol.lobbyMessage, packet)) return;
    const wol = this.WOL;
    switch (packet.command) {
      case "logIn":
        auth.handleLogin(client, packet);
        break;
      case "dname":
        break;
      case "ping":
        handlePing(client);
        break;
      case "setNewPlayerFlag":
        shop.handleNewPlayerFlag(client);
        break;
      case "modify_pet":
        shop.handlePetModification(client, packet);
        break;
      case "quick_play":
        rooms.handleQuickPlay(client, packet, wol);
        break;
      case "chance_wheel":
        shop.handleChanceWheel(client);
        break;
      case "get_medals":
        // bug: había un segundo "case get_medals" (medal_info) que nunca se ejecutaba
        popup(client, "medal_init");
        break;
      case "xpromo_fetch":
        popup(client, "xpromo_fetched");
        break;
      case "news":
        popup(client, "news");
        break;
      case "change_pet":
        shop.handleChangePet(client, packet);
        break;
      case "buy_accessory":
        shop.handleBuyAccessory(client, packet, wol);
        break;
      case "idlegift":
        popup(client, "idlegift");
        break;
      case "set_acc_load":
        shop.handleAccLoad(client, packet, wol);
        break;
      case "buy_pet":
        shop.handleBuyPet(client, packet, wol);
        break;
      case "delete_pet":
        shop.handleDeletePet(client, packet);
        break;
      case "buy_ammo":
        shop.handleBuyAmmo(client, packet, wol);
        break;
      case "set_weapons_equipped":
        shop.handleSetWeaponsEquipped(client, packet, wol);
        break;
      case "game_name_check":
        rooms.handleGameNameCheck(client, packet, wol);
        break;
      case "create_game":
        rooms.handleCreateGame(client, packet, wol);
        break;
      case "join_game":
        rooms.handleJoinGame(client, packet, wol);
        break;
    }
  }

  handleSocialCommand(client: SocialClient, packet: Protocol.SocialMessage): void {
    // La conexión social es nuestra (no del SWF): a un mensaje inválido se le responde con el error
    if (!isValid(Protocol.socialMessage, packet)) {
      return client.sendPacket(social.failure(400, "INVALID_DATA", "Mensaje no válido"));
    }
    switch (packet.command) {
      case "logIn":
        social.handleSocialLogin(client, packet);
        break;
      case "ping":
        handlePing(client);
        break;
      case "invite":
        social.handleInvite(client, packet, this.WOL);
        break;
      case "invite_answer":
        social.handleInviteAnswer(client, packet, this.WOL);
        break;
    }
  }

  handleLadderCommand(client: LadderClient, packet: Protocol.LadderMessage): void {
    if (!isValid(Protocol.ladderMessage, packet)) return;
    switch (packet.command) {
      case "ping":
        handlePing(client);
        break;
    }
  }

  handleGameCommand(client: GameClient, packet: Protocol.GameMessage): void {
    if (!isValid(Protocol.gameMessage, packet)) return;
    client.lastMessageTime = Date.now();
    switch (packet.command) {
      case "logIn":
        auth.handleLogin(client, packet);
        break;
      case "give_medal":
        // El original llamaba a handleSendMedal, que no existe (lanzaba TypeError). No sabemos qué hacía
        log.debug({ id: client.player?.id }, "give_medal sin implementar");
        break;
      case "ping":
        handlePing(client);
        break;
      case "start_server_connect":
        auth.handleStartServerConnect(client, packet, this.WOL);
        break;
      case "chat":
        game.handleChat(client, packet);
        break;
      case "on_ready":
        game.handleOnReady(client);
        break;
      case "not_ready":
        game.handleNotReady(client);
        break;
      case "map_loaded":
        break;
      case "synch_check":
        game.handleSynchCheck(client, packet);
        break;
      case "move_left":
        game.handleMoveLeft(client, packet);
        break;
      case "move_right":
        game.handleMoveRight(client, packet);
        break;
      case "move_stop":
        game.handleMoveStop(client, packet);
        break;
      case "move_jump":
        game.handleMoveJump(client, packet);
        break;
      case "projectile":
        game.handleProjectile(client, packet, this.WOL);
        break;
      case "turn_complete":
        game.handleTurnComplete(client);
        break;
      case "position":
        game.handlePosition(client, packet);
        break;
      case "request_synch":
        log.debug("request_synch");
        break;
      case "set_aim":
        game.handleSetAim(client, packet);
        break;
      case "start_fire":
        game.handleStartFire(client, packet);
        break;
      case "cancel_fire":
      case "equip":
      case "toggle_weapon":
      case "retract_rope":
      case "release_rope":
      case "stop_rope":
      case "detach":
      case "teleport_stop":
        game.handleRelay(client, packet);
        break;
      case "player_died":
        game.handlePlayerDied(client, packet);
        break;
      case "synch_pts":
        game.handleSynchPts(client, packet);
        break;
      case "log_projectile":
        game.handleLogProjectile(client, packet);
        break;
      case "synchronization":
        game.handleSynch(client, packet);
        break;
      case "exiting":
        game.handleExiting(client, packet);
        break;
    }
  }
}

function handlePing(client: { sendPacket(packet: object): void }): void {
  client.sendPacket({ command: "ping_ack" });
}

// Popups del lobby sin contenido: responden solo con el command (y solo en conexiones lobby)
function popup(client: LobbyClient, command: "medal_init" | "xpromo_fetched" | "news" | "idlegift"): void {
  if (client.connectionType == "lobby") {
    client.sendPacket({ command });
  }
}

export = Handler;
