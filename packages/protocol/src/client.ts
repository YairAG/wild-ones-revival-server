// Mensajes cliente → servidor, por tipo de conexión (ver docs/PROTOCOL.md).
// Solo se validan los campos que usa el servidor; los demás pasan tal cual (z.looseObject), porque
// muchos mensajes se reenvían a los otros jugadores sin tocar.
// Los tipos salen del código del servidor; no están verificados contra el cliente SWF original.
import { z } from "zod";

const msg = <C extends string, S extends z.ZodRawShape = Record<never, never>>(
  command: C,
  shape?: S,
) => z.looseObject({ command: z.literal(command), ...(shape ?? ({} as S)) });

const id = z.union([z.string(), z.number()]);
const point = z.tuple([z.number(), z.number()]); // campo "d": [x, y]
const color = z.union([z.string(), z.number()]);
const gameDetails = {
  mapName: z.string().optional(),
  playerCount: z.number().optional(),
  gameDuration: z.number().optional(), // minutos
  turnDuration: z.number().optional(), // segundos
};

// Compartidos por varias conexiones
// JWT del backend de cuentas (HS256, sub = id del usuario) en `token`. El cliente SWF original lo manda en
// `snum` (su campo de clave), así que también se acepta ahí
const logIn = msg("logIn", { token: z.string().optional(), snum: z.string().optional() });
const ping = msg("ping");

export const lobbyMessage = z.discriminatedUnion("command", [
  logIn,
  ping,
  msg("dname"),
  msg("setNewPlayerFlag"),
  msg("modify_pet", { petid: id, color1: color, color2: color, name: z.string() }),
  msg("change_pet", { name: id }),
  msg("quick_play", gameDetails),
  msg("game_name_check", { name: z.string() }),
  msg("create_game", { gameName: z.string(), ...gameDetails }),
  msg("join_game", { gameName: z.string() }),
  msg("chance_wheel"),
  msg("buy_accessory", { type: z.string() }),
  msg("set_acc_load", { load: z.array(z.string()) }),
  msg("buy_pet", { name: z.string(), type: z.string(), color1: z.number(), color2: z.number() }),
  msg("delete_pet", { petId: id }),
  msg("buy_ammo", { ammoType: z.string(), ammoCount: z.number() }),
  msg("set_weapons_equipped", { value: z.array(z.string()) }),
  msg("get_medals"),
  msg("xpromo_fetch"),
  msg("news"),
  msg("idlegift"),
]);

export const ladderMessage = z.discriminatedUnion("command", [ping]);

export const gameMessage = z.discriminatedUnion("command", [
  logIn,
  ping,
  msg("give_medal"),
  msg("start_server_connect", { userId: z.string() }),
  msg("chat"),
  msg("on_ready"),
  msg("not_ready"),
  msg("map_loaded"),
  msg("synch_check"),
  msg("move_left", { d: point }),
  msg("move_right", { d: point }),
  msg("move_stop", { d: point }),
  msg("move_jump", { d: point, direction: z.string().optional() }),
  // El SWF original manda ángulo y potencia como texto ("0.80", "1001.37")
  msg("set_aim", {
    value: z.union([z.number(), z.string()]),
    power: z.union([z.number(), z.string()]),
  }),
  msg("start_fire", { d: point }),
  msg("cancel_fire"),
  msg("equip"),
  msg("toggle_weapon"),
  msg("retract_rope"),
  msg("release_rope"),
  msg("stop_rope"),
  msg("detach"),
  msg("teleport_stop"),
  msg("projectile", { d: point, ammo_type: z.string(), crate: z.string().optional() }),
  msg("turn_complete"),
  msg("position"),
  msg("request_synch"),
  msg("synch_pts", { value: z.string().optional() }),
  msg("synchronization", {
    timeLoop: z.looseObject({}),
    avatarList: z.array(z.looseObject({ player: id.optional(), hp: z.string().optional() })),
  }),
  msg("player_died", { id: id }),
  msg("exiting"),
  msg("log_projectile", { weapon: z.string() }),
  // El SWF lo manda al hacer daño ({to, from, value, died}); el servidor original no lo procesa
  msg("damage"),
]);

// Conexión del frontend web (no del SWF): invitaciones a partida entre amigos
export const socialMessage = z.discriminatedUnion("command", [
  logIn,
  ping,
  msg("invite", { to: z.number().int() }), // invitar al amigo con ese id
  msg("invite_answer", { from: z.number().int(), accept: z.boolean() }), // responder la invitación de `from`
]);

export type LobbyMessage = z.infer<typeof lobbyMessage>;
export type LadderMessage = z.infer<typeof ladderMessage>;
export type GameMessage = z.infer<typeof gameMessage>;
export type SocialMessage = z.infer<typeof socialMessage>;
export type ClientMessage = LobbyMessage | LadderMessage | GameMessage | SocialMessage;
