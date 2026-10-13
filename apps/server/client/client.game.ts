// Conexión dentro de una partida: tiene el avatar del jugador, premios y envío de estadísticas
import Avatar = require("./extensions/avatar.js");
import type Client = require("./client.abstract.js");
import type Database = require("../database.js");
import type WOL = require("../wol");
import type { Player } from "wildones-protocol";
import type { GameSocket, PlayerGameStats, Rewards, UserDoc } from "../types";
import log = require("../helpers/log.js");
import levelFromXp = require("../helpers/level.js");

class GameClient {
  declare sock: GameSocket;
  declare db: Database;
  declare WOL: WOL;
  declare newPacketHeader: string;
  declare connectionType: string;
  declare initialized: boolean;
  declare mapLoaded: boolean;
  declare tempBuffer: string;
  declare tempBufferLen: number;
  declare awaitingData: boolean;
  declare dataParts: number;
  declare id: string;
  declare loggedIn: boolean;
  declare player: Player;
  declare avatar: Avatar;
  declare lastMessageTime: number; // cualquier mensaje de la partida
  declare lastChatTime: number; // último mensaje de chat (límite de 1 por segundo)
  declare shotThisTurn: boolean;
  declare startingXP: number;
  declare startingGold: number;
  declare gameId: string | null | undefined;
  declare gameSession: string;
  declare disconnected?: boolean; // nunca se asigna

  constructor(clientRef: Client) {
    /* Events */
    /* Point data to here */

    clientRef.newObject = this;

    /* References */
    this.sock = clientRef.sock;
    this.db = clientRef.db;
    this.WOL = clientRef.WOL;

    /* Connection details */
    this.newPacketHeader = "Originality is undetected plagiarism.\r\n\r\n";
    this.connectionType = clientRef.connectionType;
    this.initialized = false;
    this.mapLoaded = false; //reset this

    /* Buffers and settings */
    this.tempBuffer = "";
    this.tempBufferLen = 0;
    this.awaitingData = false;
    this.dataParts = 0;

    /* Client data */
    this.id = clientRef.id;

    /* Client state */
    this.loggedIn = false;

    /* Player data */
    this.player = {} as Player; // se rellena en setupPlayer
    this.avatar = new Avatar(this);

    /* Trackers */
    this.lastMessageTime = 0;
    this.lastChatTime = 0;
    this.shotThisTurn = false;

    /* Rewards */
    this.startingXP = 0;
    this.startingGold = 0;

    /* Slot data */
    this.gameId = null;
    this.gameSession = "";

    log.debug("Cliente game creado");
  }

  // ### initialization functions ###
  setupPlayer(doc: UserDoc | null): number {
    if (!doc) {
      return -1;
    }

    this.player.id = doc.id;
    this.player.nw = doc.nw;
    this.player.level = doc.level;
    this.player.currentPet = doc.currentPet;
    this.player.login_streak = doc.login_streak;
    this.player.playerStatus = doc.playerStatus;
    this.player.status = doc.status;
    this.player.net = doc.net;
    this.player.gamecount = doc.gamecount;
    this.player.gold = doc.gold;
    this.player.treats = doc.treats;
    this.player.hp = doc.hp;
    this.player.wins = doc.wins;
    this.player.sesscount = doc.sesscount;
    this.player.losses = doc.losses;
    this.player.speed = doc.speed;
    this.player.attack = doc.attack;
    this.player.defence = doc.defence;
    this.player.jump = doc.jump;
    this.player.xp = doc.xp;
    this.player.userAccessories = doc.userAccessories;
    this.player.durability = doc.durability;
    this.player.ownedPets = doc.ownedPets;
    this.player.userWeaponsOwned = doc.userWeaponsOwned;
    this.player.userWeaponsEquipped = doc.userWeaponsEquipped;
    this.player.allowedMaps = doc.allowedMaps;
    this.player.dname = doc.dname;
    this.player.command = "player";
    this.player.online = this.WOL.getLobbyLoad();
    log.info({ dname: this.player.dname }, "Entró a la partida");
    this.avatar.initialize();
    return 1;
  }

  //### adapters ###

  updateGame(): void {
    this.getGame().sendPacket(this.getGame().getString("game"));
  }

  setMapLoadStatus(v: boolean): void {
    this.mapLoaded = v;
  }

  updateCoordinates(x: number, y: number): void {
    this.avatar.X = x;
    this.avatar.Y = y;
  }

  updateVelocities(vx: number, vy: number): void {
    this.avatar.Vx = vx;
    this.avatar.Vy = vy;
  }

  resetTurnChanges(): void {
    this.avatar.alreadyShot = false;
    this.avatar.locked = false;
  }

  addXP(amount: number): void {
    this.player.xp += amount;
    this.player.level = levelFromXp(this.WOL.levelsObj as { xp: number }[], this.player.xp);

    this.sendUpdate();
    this.updatePlayerData();
  }

  addGold(amount: number, update?: boolean): void {
    this.player.gold += amount;
    if (update) {
      this.sendUpdate();
      this.updatePlayerData();
    }
  }

  addTreats(amount: number, update?: boolean): void {
    this.player.treats += amount;
    if (update) {
      this.sendUpdate();
      this.updatePlayerData();
    }
  }

  //### checkers ###

  ownsPet(id: string | number): boolean {
    return this.player.ownedPets[id] != null;
  }

  isCurrentPlayer(): boolean {
    return this.getGame().currentPlayer == this.player.id;
  }

  isDead(): boolean {
    return this.avatar.dead;
  }

  // ### getters ###

  getGame() {
    return this.WOL.getGame(this.gameId);
  }

  sendProjectileReward(): void {
    this.addXP(Math.floor(Math.random() * 10 + 1));
  }

  sendGameOverReward(_rank: number): void {
    //this.addGold(Config.goldSet[rank - 1], false);
    //this.addTreats(Config.treatSet[rank - 1], true);
  }

  // Le manda al jugador los datos de los demás jugadores de la partida
  sendGamePlayers(): void {
    const users = this.WOL.getGame(this.gameId).getClients();
    for (const usrKey in users) {
      const el = users[usrKey];
      if (el.player.id != this.player.id) {
        this.sendPacket(el.player);
      }
    }
  }

  sendToGame(packet: object): void {
    this.getGame().sendPacket(packet);
  }

  sendStartGame(): void {
    const cmd = {
      command: "startGame",
      randomSeed: this.getGame().randomSeed,
      co: this.getGame().getPlayerIds(),
      currentPlayer: this.getGame().getCurrentPlayer(),
      tick: this.getGame().getTick(),
      playerlist: this.getGame().getStatusCollection(),
    };

    this.sendPacket(cmd);
  }

  sendServerTick(val1: number, val2: number): void {
    const cmd = {
      id: -1,
      command: "set_tick",
      value: val1,
      turnEndTick: val2,
      tick: 0,
    };

    this.sendPacket(cmd);
  }

  sendUpdate(): void {
    this.sendPacket(this.player);
    this.WOL.updateLobbyPlayer(this.player);
  }

  sendChatMessage(msg: string): void {
    const cmd = {
      command: "chat",
      text: msg,
      id: 0,
      ordered: "true",
      tick: 0,
      date: Date.now(),
      dname: "Bot",
    };

    this.sendPacket(cmd);
  }

  // Estadísticas de fin de partida: todo en 0 salvo el orden de jugadores
  // Pantalla final del cliente (GameEarningsObj): oro total = damageGold + killsGold + placeGold, XP ganada =
  // endingXP − startingXP. Los niveles van desde 0 (el cliente muestra "nivel endLevel + 1") y place desde 1
  sendGameStats(playerOrder: (number | string)[], stats?: PlayerGameStats, earned?: Rewards): void {
    const statsCmd = {
      command: "game_stats",
      players: playerOrder,
      place: playerOrder.findIndex((id) => id == this.player.id) + 1,
      damage: Math.round(stats?.damage ?? 0),
      kills: stats?.kills ?? 0,
      placeGold: earned?.placeGold ?? 0,
      killsGold: earned?.killsGold ?? 0,
      damageGold: earned?.damageGold ?? 0,
      placeXp: earned?.placeXp ?? 0,
      killsXp: earned?.killsXp ?? 0,
      damageXp: earned?.damageXp ?? 0,
      startingXP: stats?.startingXp ?? this.player.xp,
      endingXP: this.player.xp,
      startLevel: Math.max(0, (stats?.startLevel ?? this.player.level) - 1),
      endLevel: Math.max(0, this.player.level - 1),
    };
    log.debug({ players: playerOrder }, "Envío game_stats");
    this.sendPacket(statsCmd);
  }

  // ### socket helpers ###
  // Formato: 6 dígitos de longitud + JSON. El primer mensaje lleva además la pseudo-cabecera
  sendPacket(packet: object): void {
    let str = JSON.stringify(packet);
    const len = ("000000" + str.length).slice(-6);

    if (!this.initialized) {
      this.initialized = true;
      str = this.newPacketHeader + len + str;
      this.write(str);
      return;
    }

    this.write(len + str);
  }

  write(str: string): void {
    if (!this.sock.readyState || this.disconnected) return;

    try {
      this.sock.write(str);
    } catch (e) {
      log.error({ err: e }, "Error al escribir en el socket");
    }
  }

  //### database modifiers ###

  updatePlayerData(): void {
    this.db.update({ id: this.player.id }, this.player);
  }
}

export = GameClient;
