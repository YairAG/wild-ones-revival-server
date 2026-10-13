/** Cuenta de un jugador durante la partida, para los premios y la pantalla final (game_stats) */
export type PlayerGameStats = {
  hp: number; // última vida conocida (empieza con la de su mascota; la actualiza synch_pts)
  damage: number; // daño hecho a otros
  kills: number;
  startingXp: number;
  startLevel: number;
};

/** Premios de fin de partida, por concepto */
export type Rewards = {
  placeGold: number;
  placeXp: number;
  killsGold: number;
  killsXp: number;
  damageGold: number;
  damageXp: number;
};
