// El "gerente" del servidor: carga los datos del juego, abre los puertos (WebSocket/TCP), guarda las conexiones y las
// partidas, y cada 100 ms avanza todas las partidas (update).
import Database = require("../database.js");
import PacketHandler = require("../handler");
import Slot = require("../slot");
import Client = require("../client/client.abstract.js");
import * as assets from "./assets";
import * as matchmaking from "./matchmaking";
import { listenTcp, listenWs, type Connection } from "./transport";
import type LobbyClient = require("../client/client.lobby.js");
import type LadderClient = require("../client/client.ladder.js");
import type GameClient = require("../client/client.game.js");
import type SocialClient = require("../client/client.social.js");
import type AccessoriesProperties = require("../properties/accessories.properties.js");
import type WeaponProperties = require("../properties/weapon.properties.js");
import type MapProperties = require("../properties/map.properties.js");
import type PetFoodProperties = require("../properties/pet.food.properties.js");
import type ChassisProperties = require("../properties/chassis.properties.js");
import type { Player } from "wildones-protocol";
import type { GameConfig, GameSocket } from "../types";
import log = require("../helpers/log.js");

type AnyClient = Client | LobbyClient | LadderClient | GameClient | SocialClient;

class WOL {
  declare lobbyClients: Record<string, LobbyClient>;
  declare ladderClients: Record<string, LadderClient>;
  declare socialClients: Record<string, SocialClient>;
  declare invites: Record<number, { from: number; at: number }>; // invitación pendiente, por id del invitado
  declare slots: Record<string, Slot>;
  declare db: Database;
  declare packetHandler: PacketHandler;
  declare assetsURL: string;
  declare assetsCacheVersion: string;
  declare assetsList: string[];
  declare assetsObj: Record<string, unknown>;
  declare config: GameConfig;
  declare accessoriesObj: Record<string, AccessoriesProperties>;
  declare crateObj: unknown;
  declare levelsObj: unknown;
  declare weaponsObj: Record<string, WeaponProperties>;
  declare mapsObj: Record<string, MapProperties>;
  declare petFoodsObj: Record<string, PetFoodProperties>;
  declare petsObj: Record<string, ChassisProperties>;
  declare itemLevel: Record<string, number>;
  declare DEFAULT_TIME_AFTER_WEAPON: number;
  declare procTimer: void;

  constructor() {
    //initialize containers
    this.lobbyClients = {};
    this.ladderClients = {};
    this.socialClients = {};
    this.invites = {};
    this.slots = {};

    // setup database
    this.db = new Database();
    this.db.connect();

    // setup packet Handler
    this.packetHandler = new PacketHandler(this);

    //assets
    this.assetsURL = process.env.ASSETS_URL || "http://localhost/assets/json/";
    this.assetsCacheVersion = "debug_0002";
    this.assetsList = ["Config", "Accessories", "Crate", "Gifts", "Levels", "Maps", "Other", "PetFoods", "Pets", "WeaponsGrid"];
    this.assetsObj = {};

    this.config = {} as GameConfig;
    this.accessoriesObj = {};
    this.crateObj = {};
    this.levelsObj = {};
    this.weaponsObj = {};
    this.mapsObj = {};
    this.petFoodsObj = {};
    this.petsObj = {};

    this.itemLevel = {};

    //initialize timers

    this.DEFAULT_TIME_AFTER_WEAPON = 400;
  }

  // Llama a func cada `wait` ms (o `times` veces). Si func lanza, deja de repetir
  interval(func: () => void, wait: number, times?: number): void {
    const interv = (function (w, t) {
      return function () {
        if (typeof t === "undefined" || t-- > 0) {
          setTimeout(interv, w);
          try {
            func.call(null);
          } catch {
            t = 0;
          }
        }
      };
    })(wait, times);

    setTimeout(interv, wait);
  }

  start(): void {
    this.loadAssets(0);
    this.procTimer = this.interval(this.update.bind(this), 100);
  }

  // Assets
  loadAssets(pos: number): void {
    assets.loadAssets(this, pos);
  }

  // Abre los transportes: WebSocket siempre, TCP crudo solo con TCP_ENABLED=true
  run(): void {
    if (process.env.TCP_ENABLED === "true") listenTcp(Number(process.env.TCP_PORT || 8000), (s) => this.accept(s));
    listenWs(Number(process.env.WS_PORT || 8001), (s) => this.accept(s));
  }

  // Conexión nueva (TCP o WebSocket). Empieza como Client genérico; al llegar el POST, el handler la
  // cambia por la de su tipo y avisa con "newScope"
  accept(socket: GameSocket): Connection {
    let obj: AnyClient = new Client(socket, this.db, this);
    log.debug({ socket: socket.name, id: socket.id }, "Nueva conexión");
    (obj as Client).eventTrigger.on("newScope", function () {
      obj = (obj as Client).newObject as AnyClient;
    });
    return {
      data: (chunk) => {
        try {
          this.packetHandler.handle(obj, chunk);
        } catch (e) {
          log.error({ err: e }, "Error al procesar datos");
        }
      },
      close: () => this.removeClientObj(obj),
    };
  }

  //### Timers ###

  // Cada 100 ms: avanza todas las partidas
  update(): void {
    for (const key in this.slots) {
      this.slots[key].update();
    }
  }

  //### Game related ###

  validateMapDetails<D extends matchmaking.MapDetails>(client: LobbyClient, data: D): D {
    return matchmaking.validateMapDetails(this, client, data);
  }

  findSimilarSlot(map: Slot): string | undefined {
    return matchmaking.findSimilarSlot(this, map);
  }

  findSlot(_client: LobbyClient, mapDetails: matchmaking.MapDetails, customName: string | null): string | 0 | undefined {
    return matchmaking.findSlot(this, mapDetails, customName);
  }

  createSlot(gameId: string, mapName: string, playerCount: number, gameDuration: number, turnDuration: number): void {
    this.slots[gameId] = new Slot(this, gameId, mapName, playerCount, gameDuration, turnDuration);
  }

  getJoinCommand(gameId: string | null | undefined) {
    return this.slots[gameId as string].getString("join");
  }

  getGame(gameId: string | null | undefined): Slot {
    return this.slots[gameId as string];
  }

  // Un GameClient cambió los datos del jugador: actualiza la copia de su conexión de lobby
  updateLobbyPlayer(newPlayer: Player): void {
    for (const key in this.lobbyClients) {
      const lc = this.lobbyClients[key];
      if (lc.player.id == newPlayer.id) {
        lc.player = newPlayer;
        break;
      }
    }
  }

  getLobbyLoad(): number {
    return Object.keys(this.lobbyClients).length;
  }

  // Guarda en Mongo dónde está el jugador (ver Presence en types/user.ts): en una partida, solo en el lobby
  // o desconectado. Se llama cada vez que entra o sale de algún lado
  updatePresence(id: number): void {
    const presence = this.isPlaying(id) ? "playing" : this.lobbyClientOf(id) ? "lobby" : "offline";
    this.db.update({ id }, { presence });
  }

  // La partida o sala en la que está (esperando o jugando), si está en alguna
  slotOf(id: number): Slot | undefined {
    return Object.values(this.slots).find((slot) => slot.clients[id]);
  }

  // ¿Está dentro de alguna partida o sala?
  isPlaying(id: number): boolean {
    return this.slotOf(id) !== undefined;
  }

  // Su conexión de lobby (el SWF), si la tiene abierta
  lobbyClientOf(id: number): LobbyClient | undefined {
    return Object.values(this.lobbyClients).find((client) => client.player?.id == id);
  }

  // La partida tiene su propia copia del jugador: al terminar (o al salir) se pasa a la de su lobby, si lo tiene
  // abierto. Si no, lo siguiente que guardara el lobby pisaría lo ganado en la partida
  syncLobbyPlayer(player: { id: number } & object): void {
    const lobby = this.lobbyClientOf(player.id);
    if (!lobby) return;
    for (const [key, value] of Object.entries(player)) {
      if (key == "command" || key == "online" || key == "status") continue; // son de cada conexión
      (lobby.player as unknown as Record<string, unknown>)[key] = structuredClone(value);
    }
  }

  // Sus conexiones social (el frontend); puede tener varias pestañas abiertas
  socialClientsOf(id: number): SocialClient[] {
    return Object.values(this.socialClients).filter((client) => client.player?.id == id);
  }

  //### add / remove client ###

  addClient(obj: AnyClient): void {
    log.debug({ id: obj.sock.id, type: obj.connectionType }, "Cliente registrado");
    if (obj.connectionType == "lobby") this.lobbyClients[obj.sock.id] = obj as LobbyClient;
    else if (obj.connectionType == "ladder") this.ladderClients[obj.sock.id] = obj as LadderClient;
    else if (obj.connectionType == "social") this.socialClients[obj.sock.id] = obj as SocialClient;
  }

  removeClientObj(obj: AnyClient): void {
    log.debug({ id: obj.sock.id, type: obj.connectionType }, "Desconexión");

    if (obj.connectionType == "lobby") delete this.lobbyClients[obj.sock.id];
    else if (obj.connectionType == "ladder") delete this.ladderClients[obj.sock.id];
    else if (obj.connectionType == "social") delete this.socialClients[obj.sock.id];
    else if (obj.connectionType == "game") {
      const game = obj as GameClient;
      if (game.gameId && this.slots[game.gameId]) {
        this.slots[game.gameId].removeClient(game);
      }
    } else {
      log.debug("Desconexión sin tipo de conexión");
    }
    if ("player" in obj && obj.player?.id) this.updatePresence(obj.player.id); // solo si ya había entrado
  }
}

export = WOL;
