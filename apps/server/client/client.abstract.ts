// Conexión recién abierta: todavía no se sabe si es lobby, ladder o game. Cuando llega el
// "POST /ballistic/<tipo>", handler.js crea el cliente del tipo correcto y lo avisa con fireChangeEvent().
import events = require("events");
import { randomUUID } from "crypto";
import type Database = require("../database.js");
import type WOL = require("../wol");
import type { GameSocket } from "../types";
import log = require("../helpers/log.js");

class Client {
  declare eventTrigger: events.EventEmitter;
  declare sock: GameSocket;
  declare db: Database;
  declare WOL: WOL;
  declare connectionType: string;
  declare initialized: boolean;
  declare pendingBytes: Buffer; // un mensaje que llegó a medias (ver handler/index.ts handleJSON)
  declare loggedIn: boolean | string;
  declare newObject: object;
  declare id: string;

  constructor(s: GameSocket, db: Database, wol: WOL) {
    /* Events */
    this.eventTrigger = new events.EventEmitter();
    /* References */
    this.sock = s;
    this.db = db;
    this.WOL = wol;

    /* Connection details */
    this.connectionType = "abstract";
    this.initialized = false;

    /* Buffers and settings */
    this.pendingBytes = Buffer.alloc(0);

    /* */
    this.loggedIn = "im_abstract";
    this.newObject = this;

    /* Characteristics */
    this.id = randomUUID();
  }

  fireChangeEvent(): void {
    this.eventTrigger.emit("newScope");
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

export = Client;
