// Armas que un jugador puede usar sin tenerlas en userWeaponsOwned: las de Levels.dat nivel 0 (mortar, walk...)
// y el poder de cada mascota suya (petPower). Las usan set_weapons_equipped y projectile.
import type WOL = require("../wol");

function freeWeapons(player: { ownedPets: Record<string, unknown> }, wol: WOL): string[] {
  const levels = wol.levelsObj as { weapon?: string[] }[];
  const pets = Object.values(player.ownedPets) as { type: string }[];
  const powers = pets.map((pet) => wol.petsObj[pet.type]?.petPower);
  return ["empty", "", ...(levels[0]?.weapon ?? []), ...powers];
}

export = freeWeapons;
