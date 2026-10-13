// Una partida: jugadores, estado (idle → starting → running → gameover), turnos, reloj, fin y premios.
// wol.js llama a update() cada 100 ms; cada llamada avanza el reloj (tick) 10 unidades.
import Utils = require("../helpers/utils.js");
import Field = require("../field.js");
import type CollisionAverage = require("../physics/collision.js");
import { collisionAverage } from "./collision";
import { gameRecord, gameState, playerIds, playerList, playerPositions, playerPositionsAndVelocities, statusCollection } from "./messages";
import WeaponManager = require("../weapons/weapon.manager.js");
import type Physical = require("../physics/physical.js");
import type GameClient = require("../client/client.game.js");
import type WOL = require("../wol");
import type WeaponProperties = require("../properties/weapon.properties.js");
import type { GameStatus } from "wildones-protocol";
import log = require("../helpers/log.js");

type PointXY = { X: number; Y: number };
type Packet = { [key: string]: unknown };

class Slot {
  declare WOL: WOL;
  declare gameId: string;
  declare mapName: string;
  declare playerCount: number;
  declare gameDuration: number;
  declare turnDuration: number;

  declare currentPlayer: number | string; // id del jugador en turno (pasa a string tras el primer cambio)
  declare deaths: unknown[];
  declare initialCount: number;
  declare randomSeed: number;
  declare startingTime: number;
  declare tick: number;
  declare turnEndTick: number;
  declare clients: Record<string, GameClient>; // por id de jugador
  declare status: GameStatus;
  declare min: number;
  declare skip: unknown[];
  declare time: string;
  declare cl: number;
  declare sumOfLevels: number;
  declare session: string;
  declare deadPlayers: (number | string)[];
  declare weapon: WeaponManager;
  declare field: Field;
  declare commands: unknown[];
  declare physicsObjects: Physical[];
  declare lastSynchCheck: Packet;
  declare lastSynchTick: unknown; // lo asigna handler (synch_check); no se lee
  declare completedTurns: number;
  declare synchCmd: unknown;
  declare startingTimeout: ReturnType<typeof setTimeout> | null;

  constructor(wol: WOL, gameId: string, mapName: string, playerCount: number, gameDuration: number, turnDuration: number) {
    this.WOL = wol;
    this.gameId = gameId;

    this.mapName = mapName;
    this.playerCount = playerCount;
    this.gameDuration = gameDuration;
    this.turnDuration = turnDuration;

    this.initialize();
  }

  initialize(): void {
    this.currentPlayer = -1;

    this.deaths = [];

    this.initialCount = 0;
    this.randomSeed = 0;

    this.startingTime = 0;
    this.tick = 0;
    this.turnEndTick = 0;

    this.clients = {};
    this.status = "idle";
    this.min = this.playerCount;
    this.skip = [];
    this.time = "";
    this.cl = 0;
    this.sumOfLevels = 0;
    this.session = "undefined";
    this.deadPlayers = [];
    this.initialCount = 0;

    this.weapon = new WeaponManager(this);
    this.field = new Field(this);

    this.commands = [];
    this.physicsObjects = [];

    this.lastSynchCheck = { command: "synch_check", synchCheck: "" };

    this.completedTurns = 0;

    this.synchCmd = null;
    this.startingTimeout = null;
  }

  getCollisionAverage(
    obj: Physical,
    pointSet: PointXY[],
    checkNonAvatar?: boolean,
    checkAvatar?: boolean,
    checkField?: boolean,
    checkWalls?: boolean,
  ): CollisionAverage {
    return collisionAverage(this, obj, pointSet, checkNonAvatar, checkAvatar, checkField, checkWalls);
  }

  update(): void {
    this.checkGame();

    if (this.isRunning()) {
      this.tick += 10;

      if (this.tick % 50 == 0) {
        log.debug({ tick: this.tick }, "Tick");
        this.sendTick();
      }

      // @ts-expect-error bug: Date no tiene .now, así que esta condición nunca se cumple (ver docs/BUGS.md)
      if (parseInt(this.lastSynchCheck.date) + 20 < new Date().now) {
        log.debug("Sin synch_check reciente");
      }

      //step avatar
      for (let i = 0; i < this.physicsObjects.length; i++) {
        if (this.physicsObjects[i].complete) {
          this.physicsObjects.splice(i, 1);
        } else {
          //this.physicsObjects[i].step();
          //this.physicsObjects[i].move();
        }
      }
    }
  }

  //### update methods ###

  checkIfTurnIsOver(): void {
    if (this.turnEndTick > 0 && this.turnEndTick <= this.tick) {
      log.debug({ gameId: this.gameId }, "Cambio de turno");
      this.setNextTurn(100);
      this.sendChangeTurn();
    }
  }

  checkGame(): void {
    if (!this.isRunning()) {
      const len = Object.keys(this.clients).length;

      if (len >= 2 && !this.startingTimeout) {
        //everybody is ready, there are at least 2 players and the game hasn't been set to 'starting'
        log.info({ gameId: this.gameId }, "La partida empieza en 5 s");
        this.updateGameStatus("starting");
        this.refresh();
        this.startingTimeout = setTimeout(
          function (this: Slot) {
            this.refresh();
            log.info({ gameId: this.gameId }, "Empieza la partida");
            this.startingTime = 0;
            this.sendConfirmation();
            this.startGame();
            //handle timeout
            clearTimeout(this.startingTimeout ?? undefined);
            this.startingTimeout = null;
          }.bind(this),
          5000,
        );
      } else if (len < 2) {
        //it might be starting, but if there are not enough players (some might exit) or if
        // some new players hop in and they're not "ready", the game should stop.

        if (this.status == "idle") return; //it's already been idled
        log.debug({ gameId: this.gameId }, "Partida en espera");
        this.updateGameStatus("idle");
        //handle timeout
        if (this.startingTimeout) {
          clearTimeout(this.startingTimeout ?? undefined);
          this.startingTimeout = null;
        }
        //refresh
        this.refresh();
      }
    } else {
      // Se acabó el tiempo de partida (gameDuration en ms; el tick avanza 1 cada 10 ms)
      if (this.tick >= this.gameDuration / 10) {
        log.info({ gameId: this.gameId }, "Fin de partida por tiempo");
        this.endGame();
        return;
      }

      this.checkIfTurnIsOver();
      //if only one player remains in game
      //send game over
      if (Object.keys(this.clients).length <= 1) {
        this.endGame();
        return;
      }

      if (this.countPlayersAlive() <= 1) {
        this.endGame();
        return;
      }

      //what if the current player exits?
      if (!this.clients[this.currentPlayer]) {
        this.sendChangeTurn();
      }
    }
  }

  stopGameStart(): void {
    log.debug({ gameId: this.gameId }, "Cuenta atrás cancelada");
    clearTimeout(this.startingTimeout ?? undefined);
    this.startingTimeout = null;
    this.updateGameStatus("idle");
    this.refresh();
  }

  generateRndSeed(): void {
    this.randomSeed = Utils.randInt();
  }

  setNextTurn(delay: number): void {
    this.turnEndTick = this.tick + this.turnDuration / 10 + delay;
  }

  // Acorta el turno actual (nunca lo alarga)
  setNextTurnFN(delay: number): void {
    const newTurnEndTick = this.tick + delay;
    this.turnEndTick = newTurnEndTick > this.turnEndTick ? this.turnEndTick : newTurnEndTick;
  }

  updatePlayerStatus(id: number | string, status: string): void {
    for (const key in this.clients)
      if (this.clients[key].player.id == id) {
        this.clients[key].player.status = status;
        break;
      }
    this.refresh();
  }

  updateGameStatus(status: GameStatus): void {
    this.status = status;
  }

  setPlayerDead(id: number | string): void {
    // Si ya estaba muerto no se cuenta de nuevo (antes contaba dos veces y terminaba la partida antes de tiempo)
    if (this.clients[id] && !this.clients[id].isDead()) {
      this.clients[id].avatar.dead = true;
      this.deadPlayers.push(id);
    } else {
      //its been removed from the clients array
    }
  }

  setDefaultPositions(): void {
    let positionIndex = 0;
    for (const key in this.clients) {
      if (!this.clients[key] || !this.clients[key].avatar) {
        delete this.clients[key];
        continue;
      }
      this.clients[key].avatar.X = this.WOL.mapsObj[this.mapName].positions[positionIndex][0];
      this.clients[key].avatar.Y = this.WOL.mapsObj[this.mapName].positions[positionIndex][1];

      positionIndex++;
    }
  }

  getPlayerPositions() {
    return playerPositions(this);
  }

  getPlayerPositionsAndVelocities() {
    return playerPositionsAndVelocities(this);
  }

  getRemainingTicks(): number {
    return this.turnEndTick - this.tick;
  }

  //### weps ###

  addProjectile(properties: WeaponProperties, x: number, y: number, vx: number, vy: number): void {
    log.debug({ x, y, vx, vy }, "Proyectil agregado");
    // @ts-expect-error bug: makeWeapon espera (name, properties, x, y, vx, vy) (ver docs/BUGS.md)
    this.physicsObjects.push(this.weapon.makeWeapon(properties, x, y, vx, vy));
  }

  //### player container helpers ###

  addClient(client: GameClient): void {
    this.clients[client.player.id] = client;
    if (client.avatar != null) {
      this.physicsObjects.push(client.avatar);
    } else log.warn({ id: client.player.id }, "Cliente sin avatar en la partida");

    if (this.currentPlayer == -1) this.currentPlayer = client.player.id;
    else if (client.player.id < (this.currentPlayer as number)) {
      this.currentPlayer = client.player.id;
    }
  }

  removeClient(client: GameClient): void {
    //change status from dead to disconnected
    const deadPlayerIndex = this.deadPlayers.indexOf(client.player.id);
    if (deadPlayerIndex >= 0) {
      this.deadPlayers.splice(deadPlayerIndex, 1);
    }

    delete this.clients[client.player.id];

    if (this.isStarting()) this.stopGameStart();
    else this.refresh();

    this.checkGame();
  }

  containsClient(client: GameClient): boolean {
    return this.clients[client.player.id] != null;
  }

  //### packets ###

  // A todos los jugadores de la partida. Si el paquete tiene "session", se pone la de cada uno
  sendPacket(packet: object): void {
    for (const key in this.clients) {
      const client = this.clients[key];

      if (client) {
        // eslint-disable-next-line no-prototype-builtins -- se mantiene el original (ver docs/BUGS.md)
        if (packet.hasOwnProperty("session")) (packet as Packet).session = client.gameSession;
        client.sendPacket(packet);
      }
    }
  }

  // Igual que sendPacket, pero sin enviárselo a clientExcl
  sendPacketE(packet: object, clientExcl: GameClient): void {
    for (const key in this.clients) {
      const client = this.clients[key];

      if (client && client != clientExcl) {
        // eslint-disable-next-line no-prototype-builtins -- se mantiene el original (ver docs/BUGS.md)
        if (packet.hasOwnProperty("session")) (packet as Packet).session = client.gameSession;
        client.sendPacket(packet);
      }
    }
  }

  startGame(): void {
    //updating the game status is the first thing to do
    //you don't want any 'intruders'

    this.updateGameStatus("running");
    this.generateRndSeed();
    this.setDefaultPositions();

    const cmd = {
      command: "startGame",
      randomSeed: this.randomSeed,
      co: this.getPlayerIds(),
      currentPlayer: this.getCurrentPlayer(),
      tick: this.getTick(),
      playerlist: this.getPlayerList(),
      positions: this.getPlayerPositions(),
    };

    this.initialCount = cmd.co.length;

    this.sendPacket(cmd);
    this.setNextTurn(200);
  }

  isFull(): boolean {
    return this.playerCount == this.getPlayerCount();
  }

  refresh(): void {
    this.sendPacket(this.getString("game"));
  }

  sendConfirmation(): void {
    this.sendPacket({ command: "game_join_confirmed" });
  }

  sendChangeTurn(): void {
    try {
      //what if only one player remains in game?
      if (Object.keys(this.clients).length == 1) {
        this.endGame();
        return;
      }

      if (this.clients[this.currentPlayer]) {
        this.clients[this.currentPlayer].avatar.stopWalking();
      }

      //this.synchronize();
      this.getNextPlayerId();

      this.clients[this.currentPlayer].sendServerTick(this.tick, this.turnEndTick);
      this.clients[this.currentPlayer].resetTurnChanges();
      const record = this.getGameRecord("changeTurn");

      this.sendPacket(record);
    } catch {
      // se ignora, como en el original
    }
  }

  synchronize(): void {
    for (const key in this.clients) {
      const c = this.clients[key];
      this.sendPlayerPosition(c);
    }
  }

  // Reenvía el último synch_check del jugador en turno a los demás, con el tick del servidor
  sendTick(): void {
    const cmd = this.lastSynchCheck;
    cmd["command"] = "synch_check";
    cmd["id"] = "oppenheimer";
    cmd["tick"] = this.tick;
    this.sendPacketE(cmd, this.clients[this.currentPlayer]);
  }

  sendServerTick(): void {
    const cmd = {
      id: -1,
      command: "set_tick",
      value: this.tick,
      turnEndTick: this.turnEndTick,
      tick: 0,
    };

    this.sendPacket(cmd);
  }

  endGame(): void {
    this.updateGameStatus("gameover");
    //set the status to gameover to pause any ticking, processing etc. and
    //don't free this slot. not yet.
    //give awards, show screens etc. first
    log.info({ gameId: this.gameId }, "Fin de partida");

    // Orden final: los vivos (por id; más de uno si se acabó el tiempo) y luego los muertos, del último en
    // morir al primero
    const alive = Object.values(this.clients).filter((c) => !c.isDead()).map((c) => c.player.id);
    const playerOrder = [...alive, ...this.deadPlayers.reverse()];

    if (playerOrder.length > 2) {
      for (let i = 0; i < playerOrder.length; i++) {
        if (!this.clients[playerOrder[i]]) continue;
        this.clients[playerOrder[i]].addXP(9 * (6 - i));
        this.clients[playerOrder[i]].addGold(12 * (6 - i), true);
      }
    }

    // Estadísticas del jugador: todos suman una partida, gana el único vivo y pierden los muertos. Si se acabó el
    // tiempo con varios vivos, esos empatan (ni ganan ni pierden). Quien salió antes ya no está en clients
    for (const client of Object.values(this.clients)) {
      client.player.gamecount += 1;
      if (client.isDead()) client.player.losses += 1;
      else if (alive.length == 1) client.player.wins += 1;
      client.updatePlayerData();
    }

    for (const key in this.clients) {
      this.clients[key].sendGameStats(playerOrder);
    }

    const cmd = this.getGameRecord("endGame");
    this.sendPacket(cmd);
    //now you may set it free
    const ids = Object.values(this.clients).map((c) => c.player.id);
    this.initialize();
    for (const id of ids) this.WOL.updatePresence(id); // ya no están en la partida
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

  sendPlayerPosition(c: GameClient): void {
    const cmd: Packet = {};
    cmd["command"] = "position";
    cmd["x"] = c.avatar.X;
    cmd["y"] = c.avatar.Y;
    cmd["tick"] = this.tick;
    cmd["_id"] = c.player.id;

    this.sendPacket(cmd);
  }

  requestSynch(): void {
    this.clients[this.currentPlayer].sendPacket({ command: "request_synch" });
  }

  //### getters ###

  // Pasa el turno al siguiente id mayor que siga vivo; si no hay, al menor. Devuelve -1 si nadie puede jugar
  getNextPlayerId(): number | undefined {
    let foundPlayer = false;
    for (const pKey in this.clients) {
      if (!foundPlayer) {
        if (parseInt(pKey) > (this.currentPlayer as number) && !this.clients[pKey].isDead()) {
          this.currentPlayer = pKey;
          foundPlayer = true;
        }
      }
    }

    if (!foundPlayer) {
      for (const pKey in this.clients) {
        if (!foundPlayer) {
          if (parseInt(pKey) < (this.currentPlayer as number) && !this.clients[pKey].isDead()) {
            this.currentPlayer = pKey;
            foundPlayer = true;
          }
        }
      }
    }

    if (!foundPlayer) return -1;

    log.debug({ gameId: this.gameId, currentPlayer: this.currentPlayer }, "Turno de");
  }

  countPlayersAlive(): number {
    //2 - 0
    return Object.keys(this.clients).length - this.deadPlayers.length;
  }

  getGameStatus(): GameStatus {
    return this.status;
  }

  getCurrentPlayer(): number | string {
    return this.currentPlayer;
  }

  getTick(): number {
    return this.tick;
  }

  getPlayerCount(): number {
    return Object.keys(this.clients).length;
  }

  getStatusCollection() {
    return statusCollection(this);
  }

  getPlayerList() {
    return playerList(this);
  }

  // Estado de la partida para los mensajes "game" y "join"
  getString(command: "game" | "join") {
    return gameState(this, command);
  }

  getClients(): Record<string, GameClient> {
    return this.clients;
  }

  getPlayerIds() {
    return playerIds(this);
  }

  getGameRecord(cmd: "changeTurn" | "endGame") {
    return gameRecord(this, cmd);
  }

  //### checkers ###

  isRunning(): boolean {
    return this.status == "running";
  }

  isStarting(): boolean {
    return this.status == "starting";
  }

  isGameOver(): boolean {
    return this.status == "gameover";
  }
}

export = Slot;
