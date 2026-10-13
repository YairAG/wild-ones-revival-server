// Conexión de lobby: login, tienda (oro/treats, armas, mascotas, accesorios) y buscar partida
import { randomUUID } from "crypto";
import type Client = require("./client.abstract.js");
import type Database = require("../database.js");
import type WOL = require("../wol");
import type { Player } from "wildones-protocol";
import type { GameSocket, UserDoc } from "../types";
import log = require("../helpers/log.js");
import levelFromXp = require("../helpers/level.js");

class LobbyClient {
  declare sock: GameSocket;
  declare db: Database;
  declare WOL: WOL;
  declare newPacketHeader: string;
  declare connectionType: string;
  declare initialized: boolean;
  declare pendingBytes: Buffer; // un mensaje que llegó a medias (ver handler/index.ts handleJSON)
  declare id: string;
  declare loggedIn: boolean;
  declare player: Player;
  declare gameId: string | null | undefined;
  declare gameSession: string;

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

    /* Buffers and settings */
    this.pendingBytes = Buffer.alloc(0);

    /* Client data */
    this.id = clientRef.id;

    /* Client state */
    this.loggedIn = false;

    /* Player data */
    this.player = {} as Player; // se rellena en setupPlayer

    /* Slot data */
    this.gameId = null;
    this.gameSession = "";

    log.debug("Cliente lobby creado");
  }

  // ### initialization functions ###
  setupPlayer(doc: UserDoc | null): number {
    if (!doc) {
      return -1;
    }

    this.player.id = doc.id;
    this.player.nw = doc.nw;
    // El nivel sale de la XP; se guarda para que lo vean otros (p. ej. la lista de amigos)
    this.player.level = levelFromXp(this.WOL.levelsObj as { xp: number }[], doc.xp);
    this.db.update({ id: doc.id }, { level: this.player.level });
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
    this.player.command = "setPlayer";
    this.player.online = this.WOL.getLobbyLoad();
    log.info({ dname: this.player.dname }, "Entró al lobby");
    return 1;
  }

  // ### checkers ###

  ownsPet(id: string | number): boolean {
    return this.player.ownedPets[id] != null;
  }

  // ### database modifiers ###

  updatePlayerData(): void {
    this.db.savePlayer(this.player);
  }

  updateGameKey(gameSession: string): string {
    this.db.update({ id: this.player.id }, { gkey: gameSession });
    return gameSession;
  }

  // ### property updaters  ###
  chargeTreats(amount: number): boolean {
    if (amount < 0) return false;
    this.player.treats = parseInt(String(this.player.treats));
    if (this.player.treats >= amount) {
      this.player.treats -= amount;
      this.sendUpdate();
      this.updatePlayerData();
      return true;
    } else return false;
  }

  chargeGold(amount: number): boolean {
    if (amount < 0) return false;
    this.player.gold = parseInt(String(this.player.gold));
    if (this.player.gold >= amount) {
      this.player.gold -= amount;
      this.sendUpdate();
      this.updatePlayerData();
      return true;
    } else return false;
  }

  addWeapon(type: string, amount: number): void {
    if (this.player.userWeaponsOwned[type]) this.player.userWeaponsOwned[type] += amount;
    else this.player.userWeaponsOwned[type] = amount;

    this.sendUpdate();
    this.updatePlayerData();
  }

  // Ruleta: cuesta 2 treats y da un arma al azar
  getReward(): { reward: Record<string, number> | null; special?: string } {
    if (!this.chargeTreats(2))
      return {
        reward: null,
      };

    let weaponType = "teleport";
    let amount = 0;
    let special = 0;
    const val = Math.floor(Math.random() * 100);

    if (0 <= val && val <= 7) { weaponType = "teleport"; amount = 2; special = 0; }
    else if (8 <= val && val <= 15) { weaponType = "teleport"; amount = 3; special = 0; }
    else if (16 <= val && val <= 24) { weaponType = "teleport"; amount = 4; special = 0; }
    else if (25 <= val && val <= 49) { weaponType = "grappling"; amount = 2; special = 0; }
    else if (50 <= val && val <= 58) { weaponType = "grenade"; amount = 2; special = 0; }
    else if (val == 59) { weaponType = "grenade"; amount = 50; special = 1; }
    else if (60 <= val && val <= 68) { weaponType = "flamethrower"; amount = 1; special = 0; }
    else if (val == 69) { weaponType = "flamethrower"; amount = 3; special = 0; }
    else if (70 <= val && val <= 78) { weaponType = "goo"; amount = 1; special = 0; }
    else if (val == 79) { weaponType = "goo"; amount = 3; special = 0; }
    else if (80 <= val && val <= 89) { weaponType = "mirv"; amount = 1; special = 0; }
    else if (90 <= val && val <= 94) { weaponType = "drill"; amount = 1; special = 0; }
    else if (95 <= val && val <= 100) { weaponType = "lasercannon"; amount = 1; special = 1; }

    this.addWeapon(weaponType, amount);

    return {
      reward: { [weaponType]: amount },
      special: special ? "true" : "false",
    };
  }

  // ### keygen(s) ###

  generateGameKey(): string {
    // Pase de un solo jugador para entrar a la partida (ver handler/auth.ts). UUID: 122 bits aleatorios seguros
    this.gameSession = this.updateGameKey(randomUUID());
    return this.gameSession;
  }

  // ### reply methods ###

  sendPlayerSetup(): void {
    this.sendPacket(this.player);
    this.player.command = "player";
  }

  sendUpdate(): void {
    this.sendPacket(this.player);
  }

  sendJoinGame(): void {
    const cmd = this.WOL.getJoinCommand(this.gameId);

    cmd.session = this.generateGameKey();
    this.sendPacket(cmd);
  }

  // ### socket helpers ###
  // Formato: 6 dígitos de longitud + JSON. El primer mensaje lleva además la pseudo-cabecera
  sendPacket(packet: object): void {
    let str = JSON.stringify(packet);
    const len = ("000000" + Buffer.byteLength(str)).slice(-6); // en bytes, como el SWF

    if (!this.initialized) {
      this.initialized = true;
      str = this.newPacketHeader + len + str;
      this.write(str);
      return;
    }

    this.write(len + str);
  }

  write(str: string): void {
    if (!this.sock.readyState) return;

    try {
      this.sock.write(str);
    } catch (e) {
      log.error({ err: e }, "Error al escribir en el socket");
    }
  }
}

export = LobbyClient;
