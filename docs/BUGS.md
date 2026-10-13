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
- ~~**`packet.hasOwnProperty(...)` en `slot.sendPacket/sendPacketE`**~~ (arreglado, `Object.hasOwn`): un mensaje
  reenviado con un campo llamado `hasOwnProperty` hacía fallar el reenvío (se perdía para todos).
- ~~**`projectile` no revisaba si el jugador tiene el arma**~~ (arreglado): se podía disparar cualquier arma de
  WeaponsGrid sin comprarla. Ahora solo las gratis (nivel 0, poder de su mascota) o con munición; las de cajas no
  se pueden revisar (el servidor no sabe qué salió de cada caja).
- ~~**`chat` sin filtro**~~ (arreglado): se reenviaba el objeto tal cual, con cualquier campo, y se podía hablar
  con el `id`/`dname` de otro. Ahora el servidor arma el mensaje (texto de hasta 200 caracteres, 1 por segundo).
  Sigue sin filtro de groserías (el del chat global está en wildones-accounts).
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
- ~~`handleAccLoad`: contaba repetidos por `accessoriesObj[item].type` (único por accesorio)~~ (arreglado): nunca
  detectaba dos accesorios de la misma categoría, y con uno que no existe lanzaba TypeError.
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
- ~~`sendTick` reenviaba el último `synch_check` del jugador activo pero sobrescribía `tick` con el tick del
  servidor~~ (arreglado: se reenvía en cuanto llega, con su tick; falta confirmarlo jugando). Probable causa del
  desync: el cliente es lockstep y quien no está en turno solo avanza hasta el `tick` del
  último comando recibido (`TimeLoop.canTick`); `synch_check` no está en `ignoreCommandTick`, así que es su
  reloj. Con el tick del servidor (que puede ir adelantado al del jugador), los demás simulan por delante y los
  movimientos y disparos que llegan con un tick ya pasado se ejecutan tarde (`addCommand`: `commandTick <
  currentTick` → se procesa en ese momento). Además se reenvía cada 50 ticks del servidor, no cuando llega.
- ~~`slot/index.ts` `update`: comparaba con `new Date().now` (siempre `undefined`)~~ (quitado: solo era un log de
  depuración, y con `Date.now()` se habría escrito cada 10 ms).
- `handlePlayerKill` y `handleRequestSynch` existen pero no están enrutados (y `handleRequestSynch` llama a
  `getSynchCommand`, que no existe).
- ~~`game_name_check` no convertía espacios en guiones como `create_game`~~ (arreglado): "Sala 1" aparecía libre
  aunque existiera "Sala-1".
- ~~`delete_pet` dejaba `currentPet` como número (`1`) y `change_pet` como texto (`"2"`)~~ (arreglado: texto).
- `weapons/mortar.ts`: construir un `Mortar` lanza `TypeError` (`Physical.apply` sobre una clase).

## Protocolo / transporte

- ~~Mensajes partidos en varios paquetes TCP solo se reensamblaban en conexiones `game`~~ (arreglado: en todas).
- ~~Si un comando lanzaba una excepción, se descartaba todo lo que quedaba en ese paquete TCP~~ (arreglado: solo se
  pierde ese mensaje, ver `dispatch` en handler/index.ts).
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
