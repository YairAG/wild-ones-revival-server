// Premios de fin de partida. El juego original los calculaba en su servidor, que no tenemos: los de lugar son
// los del servidor de 2016 (9 XP y 12 de oro por cada lugar por debajo de 6) y los de eliminaciones y daño son
// nuestros. En partidas de 2 jugadores van a la mitad (para que jugar contra una cuenta propia rinda menos).
import type { Rewards } from "../types/game-stats";

const KILL_GOLD = 10;
const KILL_XP = 15;
const DAMAGE_PER_POINT = 100; // 1 de oro y 1 de XP por cada 100 de daño

/** place: 0 = primero. players: cuántos empezaron la partida */
function rewards(place: number, kills: number, damage: number, players: number): Rewards {
  const factor = players <= 2 ? 0.5 : 1;
  const scale = (value: number) => Math.floor(Math.max(0, value) * factor);
  const damagePoints = Math.floor(damage / DAMAGE_PER_POINT);
  return {
    placeGold: scale(12 * (6 - place)),
    placeXp: scale(9 * (6 - place)),
    killsGold: scale(KILL_GOLD * kills),
    killsXp: scale(KILL_XP * kills),
    damageGold: scale(damagePoints),
    damageXp: scale(damagePoints),
  };
}

export = rewards;
