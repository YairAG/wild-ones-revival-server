// Conexión "social" del frontend web (no del SWF): por aquí llegan y salen las invitaciones a partida.
// Mismo formato que las demás conexiones: 6 dígitos de longitud + JSON.
import type Client = require("./client.abstract.js");
import type Database = require("../database.js");
import type WOL = require("../wol");
import type { PlayerRef, SocialServerMessage } from "wildones-protocol";
import type { GameSocket } from "../types";
import log = require("../helpers/log.js");

class SocialClient {
  declare sock: GameSocket;
  declare db: Database;
  declare WOL: WOL;
  declare connectionType: string;
  declare initialized: boolean;
  declare tempBuffer: string;
  declare tempBufferLen: number;
  declare awaitingData: boolean;
  declare dataParts: number;
  declare id: string;
  declare player: PlayerRef | null; // null hasta que hace logIn

  constructor(clientRef: Client) {
    clientRef.newObject = this;
    this.sock = clientRef.sock;
    this.db = clientRef.db;
    this.WOL = clientRef.WOL;
    this.connectionType = clientRef.connectionType;
    this.initialized = false;
    this.tempBuffer = "";
    this.tempBufferLen = 0;
    this.awaitingData = false;
    this.dataParts = 0;
    this.id = clientRef.id;
    this.player = null;
  }

  sendPacket(packet: SocialServerMessage | { command: "ping_ack" }): void {
    const str = JSON.stringify(packet);
    const len = ("000000" + str.length).slice(-6);
    // El primer mensaje lleva la misma pseudo-cabecera que las otras conexiones
    const header = this.initialized ? "" : "Originality is undetected plagiarism.\r\n\r\n";
    this.initialized = true;
    this.write(header + len + str);
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

export = SocialClient;
