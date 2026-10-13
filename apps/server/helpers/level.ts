// Nivel a partir de la XP, igual que el cliente original (Player.level): el primer nivel cuya XP mínima
// (Levels.dat) es mayor que la tuya. Pasado el último nivel de la tabla, cada nivel más cuesta 5580 XP.
function levelFromXp(levels: { xp: number }[], xp: number): number {
  const last = levels.length - 1;
  if (last < 0) return 0; // sin tabla de niveles
  for (let level = 1; level <= last; level++) {
    if (xp < levels[level].xp) return level;
  }
  return last + 1 + Math.floor((xp - levels[last].xp) / 5580);
}

export = levelFromXp;
