// Mensajes servidor → cliente (ver docs/PROTOCOL.md). Solo tipos: el servidor no se valida a sí mismo.
import type { GameMessage } from "./client";

type Id = number | string;

export interface Pet {
  id: number;
  name: string;
  type: string;
  gender?: string;
  pers?: string;
  color1?: string | number;
  color2?: string | number;
  kills?: number;
  deaths?: number;
  accessories: string[];
}

/** Datos del jugador. Se envía como mensaje con command "setPlayer" (primera vez en lobby) o "player". */
export interface Player {
  command: "setPlayer" | "player";
  id: number;
  dname: string;
  online: number;
  nw: number;
  level: number;
  currentPet: Id;
  login_streak: number;
  playerStatus: string;
  status: string;
  net: string;
  gamecount: number;
  gold: number;
  treats: number;
  hp: number;
  wins: number;
  losses: number;
  sesscount: number;
  xp: number;
  speed: number;
  attack: number;
  defence: number;
  jump: number;
  userAccessories: string[];
  durability: Record<string, number>;
  ownedPets: Record<string, Pet>;
  userWeaponsOwned: Record<string, number>; // bug: a veces NaN, que viaja como null (ver docs/BUGS.md)
  userWeaponsEquipped: string[];
  allowedMaps: string[];
}

export type GameStatus = "idle" | "starting" | "running" | "gameover";

/** Estado de una partida. "join" se envía en lobby; "game" dentro de la partida. */
export interface GameState {
  command: "join" | "game";
  id: string;
  status: GameStatus;
  name: string;
  map: string;
  playerCount: number;
  min: number;
  players: { guid: number; status: string }[];
  gameDuration: number; // ms
  turnDuration: number; // ms
  skip: unknown[];
  time: number;
  cl: number;
  sumOfLevels: number;
  session: string;
}

export interface GameRecord {
  command: "changeTurn" | "endGame";
  randomSeed: number;
  co: string[];
  playerlist: Player[];
  tick: 0;
  currentPlayer: Id;
  why: string;
}

export interface StartGame {
  command: "startGame";
  randomSeed: number;
  co: string[];
  currentPlayer: Id;
  tick: number;
  playerlist: Player[];
  positions: { id: number; x: number; y: number }[];
}

export interface GameStats {
  command: "game_stats";
  players: Id[];
  place: number;
  damage: number;
  kills: number;
  startLevel: number;
  endLevel: number;
  startingXP: number;
  endingXP: number;
  damageGold: number;
  killsGold: number;
  placeGold: number;
  damageXp: number;
  placeXp: number;
  killsXp: number;
}

/** Un jugador en un mensaje de invitación */
export interface PlayerRef {
  id: number;
  dname: string;
}

/** Mensajes de la conexión social (frontend web): invitaciones a partida */
export type SocialServerMessage =
  | { command: "social_ready" } // login correcto
  | { command: "invite"; from: PlayerRef } // te invitaron
  | { command: "invite_sent"; to: PlayerRef } // tu invitación llegó
  | { command: "invite_accepted"; by: PlayerRef } // aceptaron tu invitación: los dos van a la sala
  | { command: "invite_declined"; by: PlayerRef }
  | { command: "invite_error"; error: string }; // mensaje para mostrar

export type ServerMessage =
  | Player
  | GameState
  | GameRecord
  | StartGame
  | GameStats
  | { command: "ping_ack" }
  | { command: "game_name_return"; name: string; value: 0 | 1 }
  | {
      command: "chance_wheel_return";
      value: { reward: Record<string, number> | null; special?: "true" | "false" };
    }
  | { command: "medal_init" | "xpromo_fetched" | "news" | "idlegift" | "game_join_confirmed" }
  | { command: "synch_check"; id: "oppenheimer"; tick: number; [key: string]: unknown }
  | { command: "set_tick"; id: -1; value: number; turnEndTick: number; tick: 0 }
  | { command: "set_synch"; id: "oppenheimer"; [key: string]: unknown }
  | SocialServerMessage
  // Acciones del jugador en turno, reenviadas tal cual a los demás
  | Extract<GameMessage, { command: RelayedCommand }>;

type RelayedCommand =
  | "chat"
  | "move_left"
  | "move_right"
  | "move_stop"
  | "move_jump"
  | "set_aim"
  | "start_fire"
  | "cancel_fire"
  | "equip"
  | "toggle_weapon"
  | "retract_rope"
  | "release_rope"
  | "stop_rope"
  | "detach"
  | "teleport_stop"
  | "projectile"
  | "exiting";
