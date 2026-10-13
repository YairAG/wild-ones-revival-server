// Conexión de ladder (ranking). Hoy solo responde ping; setupPlayer no se llama nunca
import type Client = require("./client.abstract.js");
import type Database = require("../database.js");
import type WOL = require("../wol");
import type { Player } from "wildones-protocol";
import type { GameSocket, UserDoc } from "../types";
import log = require("../helpers/log.js");

class LadderClient {
  declare sock: GameSocket;
  declare db: Database;
  declare WOL: WOL;
  declare newPacketHeader: string;
  declare connectionType: string;
  declare initialized: boolean;
  declare pendingBytes: Buffer; // un mensaje que llegó a medias (ver handler/index.ts handleJSON)
  declare id: string;
  declare player: Player;

  constructor(clientRef: Client) {
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

    /* Player data */
    this.player = {} as Player;

    log.debug("Cliente ladder creado");
  }

  // ### initialization functions ###
  setupPlayer(doc: UserDoc): void {
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
    this.player.command = "setPlayer";
    this.player.online = this.WOL.getLobbyLoad();
    log.info({ dname: this.player.dname }, "Entró al ladder");
  }

  // ### socket helpers ###
  sendPacket(packet: object): void {
    let str = JSON.stringify(packet);
    const len = ("000000" + Buffer.byteLength(str)).slice(-6); // en bytes, como el SWF
    log.debug({ packet: str }, "Envío al ladder");

    if (!this.initialized) {
      this.initialized = true;
      str = this.newPacketHeader + len + str;
      log.debug("Primer mensaje al ladder");
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

export = LadderClient;
