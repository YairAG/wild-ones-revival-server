# Bugs conocidos

Encontrados al revisar el código. No se arreglan durante la migración (para no cambiar comportamiento);
cada uno se corrige después en su propio commit.

## Seguridad

- ~~**Path traversal en `log_projectile`**~~ (arreglado al pasar a pino: ya no se escriben archivos). Antes `data.weapon` venía del cliente y
  se usaba en la ruta `logs/<weapon>_xy.txt`.
- ~~**Credenciales en logs y contraseña en texto plano**~~ (arreglado): el login ahora es con JWT; el servidor
  no recibe ni guarda contraseñas. Pino tapa `token`/`snum`. Solo el log `debug` "Datos recibidos" muestra el
  token crudo.
- ~~**`snum` se reparte a otros jugadores**~~ (arreglado): `setupPlayer` copiaba `doc.snum` al objeto `player`, que se enviaba a
  todos en la partida (`sendGamePlayers`, `sendToGame`, `playerlist` de `startGame`).
- **`player_died` sin validar** (mitigado): antes cualquier jugador podía matar a otro en cualquier momento, por
  `player_died` o con `hp` 0 en `synchronization`. Ahora solo cuenta lo que reporta el jugador en turno. Sigue
  abierto: durante **su** turno, un jugador puede declarar muerto a cualquiera. Se cierra cuando el servidor
  simule (ver [SIMULACION.md](SIMULACION.md)).
- ~~Muerte contada dos veces~~ (arreglado): reportar dos veces la misma muerte la contaba dos veces y, con 3+
  jugadores, terminaba la partida con jugadores vivos.
- **`packet.hasOwnProperty(...)` en `slot.sendPacket/sendPacketE`**: un mensaje reenviado con un campo
  llamado `hasOwnProperty` hace fallar el reenvío (se pierde para todos).
- **`chat` sin filtro**: se reenvía el objeto tal cual, con cualquier campo que mande el cliente.
- ~~**`gkey` débil**~~ (arreglado): era `Math.random().toString(36).substring(7)` (~5-6 caracteres); ahora es
  `crypto.randomUUID()`, y es de un solo uso: se borra (de forma atómica) al entrar a la partida.
- **`updatePlayerData` guarda el objeto `player` entero** en Mongo, incluidos `command` y `online`, y el
  `status` de la sala. ~~Ese "ready" se volvía a cargar en la siguiente partida~~ (arreglado): al entrar a una
  partida el `status` vuelve a "waiting". El valor inicial "playing" viene del registro original.

## Errores que lanzan excepción (atrapada, el comando no hace nada)

- ~~`handler/shop.ts` `handleSetWeaponsEquipped`: usaba `invalidItemLog` sin `this.` → `ReferenceError`~~ (arreglado).
- ~~`helpers/logger.ts` usaba `fs` sin importarlo~~ (archivo eliminado al pasar a pino).
- ~~`wol/matchmaking.ts` `findSlot` con nombre propio: usaba `tmpId` sin definir si el nombre ya existía~~ (arreglado).
- ~~`logIn` en una conexión `game` llamaba a `sendPlayerSetup`, que `GameClient` no tiene~~ (arreglado).
- ~~`give_medal` llamaba a `handleSendMedal`, que no existe~~ (ahora no hace nada: no sabemos qué hacía).
- ~~`join_game` metía al cliente de **lobby** en la partida (`gameRef.addClient(client)`), aunque no tiene avatar~~ (arreglado).

## Lógica

- `get_medals`: en el original había un segundo `case` (respondía `medal_info`) que nunca se ejecutaba.
- `handleAccLoad`: cuenta repetidos por `accessoriesObj[item].type` (único por accesorio), así que nunca detecta
  dos accesorios de la misma categoría.
- ~~`projectile` restaba munición aunque el jugador no tuviera ese arma~~ (arreglado): con `mortar` y los
  poderes de mascota, que son gratis, quedaba `undefined - 1 = NaN`, que se guardaba en Mongo y viajaba como
  `null`. Ahora solo se resta si el arma está en `userWeaponsOwned`.
- ~~`set_weapons_equipped`: las armas gratis estaban escritas a mano~~ (arreglado): eran las de
  `Levels.dat[0].weapon` del original, así que los demás poderes de mascota (scratch, giant, tongue...) se
  rechazaban aunque tuvieras la mascota. Ahora son gratis las de `Levels.dat` nivel 0 y el `petPower` de cada
  mascota del jugador.
- ~~`turn_complete` no hacía nada~~ (arreglado): ahora el jugador en turno puede terminar su turno.
- ~~`gameDuration` no se aplicaba~~ (arreglado): al acabarse el tiempo termina la partida, con los vivos
  empatados. (El original probablemente hacía "muerte súbita" con agua subiendo: `disaster: flood` en los
  mapas. Queda para cuando exista `packages/sim`.)
- ~~Premios de fin de partida solo con más de 2 jugadores; `game_stats` siempre iba en 0~~ (arreglado): el
  cliente usa esos campos para la pantalla final (lugar, oro, XP ganada, eliminaciones, "subiste de nivel"), así
  que siempre decía 0. Ahora el servidor cuenta daño (con `synch_pts`, que cada cliente manda con su vida nueva al
  recibir daño) y eliminaciones, da premios también con 2 jugadores (a la mitad) y los manda en `game_stats`
  (ver PROTOCOL.md 5.5). Sigue: nadie llama a `requestSynch`, así que `synchronization` no llega en partida.
- ~~`level` nunca cambiaba~~ (arreglado): el cliente calcula el nivel a partir de `xp` y `Levels.dat`, pero el
  servidor no lo guardaba y se quedaba en 0. Ahora se calcula igual (`helpers/level.ts`) al entrar al lobby y al
  ganar XP, y se guarda.
- ~~`wins`, `losses` y `gamecount` nunca cambiaban~~ (arreglado): al terminar la partida todos suman una
  partida, gana el único vivo y pierden los muertos. Si se acaba el tiempo con varios vivos, esos empatan.
- `sendTick` reenvía el último `synch_check` del jugador activo pero sobrescribe `tick` con el tick del servidor.
  Posible causa del desync observado (sin verificar).
- `slot/index.ts` `update`: compara con `new Date().now` (siempre `undefined`), así que el aviso "haven't received
  tick" nunca se dispara.
- `handlePlayerKill` y `handleRequestSynch` existen pero no están enrutados (y `handleRequestSynch` llama a
  `getSynchCommand`, que no existe).
- ~~`game_name_check` no convertía espacios en guiones como `create_game`~~ (arreglado): "Sala 1" aparecía libre
  aunque existiera "Sala-1".
- ~~`delete_pet` dejaba `currentPet` como número (`1`) y `change_pet` como texto (`"2"`)~~ (arreglado: texto).
- `weapons/mortar.ts`: construir un `Mortar` lanza `TypeError` (`Physical.apply` sobre una clase).

## Protocolo / transporte

- Mensajes partidos en varios paquetes TCP solo se reensamblan en conexiones `game`; en `lobby`/`ladder` se pierden.
- Si un comando lanza una excepción, se descarta todo lo que quedaba en ese paquete TCP (otros mensajes que
  llegaron pegados se pierden sin aviso).
- La longitud del mensaje se cuenta en caracteres JS, no en bytes (posible problema con ñ/tildes).

## Código muerto

- La física del servidor no corre: `step()`/`move()` comentados en `slot/index.ts`, `Field` nunca carga el bitmap,
  `addProjectile` no se llama y `makeWeapon` tiene otra firma. Bugs dentro de esa física (marcados en el
  código con `@ts-expect-error` o `// bug:`), que hoy no se ejecutan:
  - `avatar.ts`: usa `Utils` sin importarlo (`export()`), `X`/`Y`/`gA`/`A`/`Va` sin `this.` en `step()`,
    resta un número a la partida (`getGame() - superJumpTick`), `monkeyClimb()` sin implementar, y el setter
    `climbing` escribe en `_climing` (typo), así que nunca cambia.
  - `physical.ts`: `onFrame()` usa `A` sin `this.`.
- (Borrados por no usarse: `client/extensions/avatar_old.js`, `misc/field/field.js`, `crumbs/config.json`.)
