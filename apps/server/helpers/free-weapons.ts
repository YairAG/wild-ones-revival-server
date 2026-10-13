// Armas que cualquiera puede usar sin tenerlas en userWeaponsOwned: las de Levels.dat nivel 0 (mortar, walk...) y
// los poderes de mascota (petWeapon en WeaponsGrid). Los poderes van todos: el cliente solo muestra el de la
// mascota actual, y su Levels.dat (el del frontend) los trae como armas por defecto, así que los manda al equipar
// aunque el del servidor no. Las usan set_weapons_equipped y projectile.
import type WOL = require("../wol");

function freeWeapons(wol: WOL): string[] {
  const levels = wol.levelsObj as { weapon?: string[] }[];
  const powers = Object.values(wol.weaponsObj)
    .filter((weapon) => weapon.petWeapon)
    .map((weapon) => weapon.type);
  return ["empty", "", ...(levels[0]?.weapon ?? []), ...powers];
}

export = freeWeapons;
