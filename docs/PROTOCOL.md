# Protocolo cliente ↔ servidor

Sacado del código actual (`handler/`, `slot/`, `wol/`, `client/`). Todo lo que aparece aquí se
puede verificar en esos archivos. Lo que hacía el **cliente** Flash con cada mensaje no está en este repo; se
marca como *desconocido* cuando importa.

Los tipos de TypeScript y los esquemas de validación de todos estos mensajes están en el paquete
`wildones-protocol` (`packages/protocol/src/`): `client.ts` (cliente → servidor) y `server.ts`
(servidor → cliente). Se pueden importar desde el frontend.

Convenciones:
- **C→S**: cliente a servidor. **S→C**: servidor a cliente.
- "Se ignora" = el servidor no hace nada y no responde.
- "A los demás" = a todos los jugadores de la partida excepto el que lo envió (`sendPacketE`).
- "A todos" = a todos los jugadores de la partida, incluido el que lo envió (`sendPacket`).

---

## 1. Transporte

Dos transportes con **exactamente el mismo protocolo** (todo lo de este documento vale para los dos):

| Transporte | Dirección | Cuándo |
|---|---|---|
| WebSocket | `ws://host:WS_PORT` (8001 por defecto) | Siempre activo. Es el que usa un navegador. |
| TCP crudo | `host:TCP_PORT` (8000 por defecto) | Solo con `TCP_ENABLED=true`. |

En **WebSocket**, cada mensaje WebSocket se trata como un trozo de datos del socket TCP:

- El primer mensaje del cliente es el mismo `POST /ballistic/<tipo>?... HTTP/1.1\r\n...\r\n\r\n` (1.2). La ruta
  de la URL del WebSocket no importa.
- Después, cada mensaje WebSocket lleva uno o más mensajes `000018{...}` (1.3).
- El servidor responde en **texto** o **binario** según cómo le habló el cliente por última vez. Ruffle
  (el emulador de Flash) usa binario, así que puede conectarse directo, sin `websockify`.

Ejemplo desde un navegador:

```js
const ws = new WebSocket("ws://localhost:8001");
ws.onopen = () => {
  ws.send("POST /ballistic/lobby?session=x HTTP/1.1\r\n\r\n");
  const msg = JSON.stringify({ command: "ping" });
  ws.send(String(msg.length).padStart(6, "0") + msg);
};
// Primera respuesta: "Originality is undetected plagiarism.\r\n\r\n000022{\"command\":\"ping_ack\"}"
ws.onmessage = (e) => console.log(e.data);
```

### 1.1 Política de Flash

Si un paquete contiene `<policy-file-request/>`, el server responde (con `\0` al final) y descarta el resto
del paquete:

```
<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>\0
```

### 1.2 Apertura (pseudo-HTTP)

Lo primero que manda el cliente en cada conexión es una cabecera estilo HTTP:

```
POST /ballistic/<tipo>?<query> HTTP/1.1\r\n
<headers...>\r\n
\r\n
<primer mensaje opcional>
```

- `<tipo>` es `lobby`, `ladder` o `game` (se toma el 3.er segmento de la ruta). Fija el tipo de conexión
  para siempre.
- Las cabeceras se ignoran. Lo que va después de `\r\n\r\n` se procesa como mensajes.
- **lobby / ladder**: la query se ignora.
- **game**: la query se lee **por posición**, no por nombre: el 1.er valor es el `gameId` y el 2.º la
  `session`. Ejemplo: `POST /ballistic/game?gameId=Sink-or-Swim_2_60000_10000_0&session=0b4d7a1e-9c2f-4e8a-b5d3-6f1a2c7e9d40 HTTP/1.1`.

### 1.3 Mensajes

Cada mensaje = **6 dígitos con la longitud** + **JSON**:

```
000018{"command":"ping"}
```

- La longitud va **en bytes** (UTF-8), como la cuenta el SWF (`writeUTFBytes` / `readUTFBytes`): `ñ` cuenta 2.
- Puede haber varios mensajes seguidos en un mismo paquete.
- Si un mensaje llega partido en varios paquetes, se guarda hasta que llegue el resto (en todas las conexiones;
  máximo 256 KB pendientes).
- JSON inválido o un comando que lanza una excepción: se loguea y se descarta solo ese mensaje.
- Cada mensaje se **valida** contra el esquema de su tipo de conexión (`packages/protocol/src/client.ts`).
  Si no cumple (campo con tipo incorrecto, falta un campo obligatorio, `command` desconocido o de otra
  conexión), se loguea `!! Mensaje inválido descartado: ...` y se ignora. Los campos extra se permiten y se
  conservan.

La **primera** respuesta del servidor en cada conexión va precedida de una pseudo-cabecera:

```
Originality is undetected plagiarism.\r\n\r\n000022{"command":"ping_ack"}
```

Las siguientes respuestas van solo con longitud + JSON.

---

## 2. Objetos que se repiten

### 2.1 `player` (datos del jugador)

Se construye en `setupPlayer` copiando campos del documento de Mongo. Se envía tal cual como mensaje (su
campo `command` dice qué es):

```json
{
  "id": 142603, "dname": "EjemploUsuario", "command": "player", "online": 3,
  "nw": -1, "level": 0, "currentPet": "1", "login_streak": 1,
  "playerStatus": "playing", "status": "playing", "net": "M",
  "gamecount": 100, "gold": 1000, "treats": 200, "hp": 500000,
  "wins": 0, "losses": 0, "sesscount": 0, "xp": 0,
  "speed": 5, "attack": 100, "defence": 5, "jump": 5,
  "userAccessories": ["..."], "durability": {"...": 30},
  "ownedPets": {"1": {"id": 1, "name": "...", "type": "dog", "gender": "M", "pers": "brave",
                       "color1": "0x6C6C6C", "color2": "0xE1E2E3", "kills": 0, "deaths": 0,
                       "accessories": []}},
  "userWeaponsOwned": {"grenade": 3}, "userWeaponsEquipped": ["walk", "mortar"],
  "allowedMaps": ["Crash Landing"]
}
```

- `command`: `"setPlayer"` la primera vez en lobby, `"player"` el resto.
- `online`: número de conexiones lobby abiertas.
- En partida, `status` se usa para `"ready"`.

### 2.2 `game` / `join` (estado de una partida)

Lo genera `Slot.getString(command)`:

```json
{
  "command": "game", "id": "Sink-or-Swim_2_60000_10000_0", "status": "starting",
  "name": "Sink or Swim", "map": "Sink or Swim",
  "playerCount": 2, "min": 2, "players": [{"guid": 142603, "status": "ready"}],
  "gameDuration": 60000, "turnDuration": 10000,
  "skip": [], "time": 1791400000000, "cl": 0, "sumOfLevels": 0, "session": "undefined"
}
```

- `status`: `idle` (esperando), `starting` (cuenta atrás de 5 s), `running`, `gameover`.
- `playerCount`: jugadores conectados ahora. `min`: jugadores máximos de la partida.
- `gameDuration` y `turnDuration` van en **milisegundos**.
- `session`: en `join` es la clave para la conexión game; al enviarlo a una partida se reemplaza por la
  `gameSession` de cada jugador.

### 2.3 Registro de partida (`changeTurn`, `endGame`)

Lo genera `Slot.getGameRecord(cmd)`:

```json
{
  "command": "changeTurn", "randomSeed": 512, "co": ["142603", "142604"],
  "playerlist": [{"...player..."}], "tick": 0, "currentPlayer": "142604", "why": "Because we can."
}
```

### 2.4 Números codificados

Algunos campos numéricos viajan como **16 caracteres hex** = un `double` IEEE-754 big-endian
(`Utils.intToString` / `Utils.stringToInt`). Ej.: `0` → `"0000000000000000"`. Se usa en `hp` de
`synchronization` y en `value` de `synch_pts`.

---

## 3. Lobby

### C→S

| command | Payload | Efecto | Respuesta |
|---|---|---|---|
| `logIn` | `{"token":"<jwt>"}` | Verifica el JWT (ver 3.1) y busca en Mongo el usuario con `id = sub`. | `player` con `command:"setPlayer"` y luego `player` con `command:"player"`. Si falla, nada. |
| `ping` | `{}` | — | `{"command":"ping_ack"}` |
| `dname` | — | Se ignora. | — |
| `setNewPlayerFlag` | `{}` | `player.nw = -1`, guarda en Mongo. | — |
| `modify_pet` | `{"petid":"1","color1":"0x..","color2":"0x..","name":"Rex"}` | Cambia colores y nombre de la mascota, guarda. | — |
| `change_pet` | `{"name":"2"}` (`name` = id de mascota) | Cambia `currentPet` si la tiene, guarda. | `player` |
| `quick_play` | `{"mapName":"Sink or Swim","playerCount":2,"gameDuration":1,"turnDuration":10}` | Valores no permitidos por `Config` se cambian por uno al azar; mapa inexistente → `"Sink or Swim"`. Busca o crea partida. Genera `session` nueva (UUID) y la guarda en Mongo como `gkey`. | `join` (2.2) |
| `game_name_check` | `{"name":"Mi sala"}` | Solo `[a-zA-Z0-9- ]`; si no, nada. | `{"command":"game_name_return","name":"Mi sala","value":1}` (1 libre, 0 ocupado) |
| `create_game` | `{"gameName":"Mi sala","mapName":..,"playerCount":..,"gameDuration":..,"turnDuration":..}` | Espacios → `-`. Si ya existe responde `game_name_return` con `value:0`. Si no, crea la partida con ese id. | `join` |
| `join_game` | `{"gameName":"Mi sala"}` | Si existe y no está corriendo, mete al cliente y responde. Si no, nada. | `join` |
| `chance_wheel` | `{}` | Cobra 2 treats y da un arma al azar. | `player` (varias veces) y `{"command":"chance_wheel_return","value":{"reward":{"grenade":2},"special":"false"}}`; sin treats: `"value":{"reward":null}` |
| `buy_accessory` | `{"type":"UniHorn"}` | Cobra precio de `Accessories` (oro o treats), agrega a `userAccessories`. | `player` |
| `set_acc_load` | `{"load":["UniHorn","..."]}` | Si los tiene todos, los pone a la mascota actual. | `player` |
| `buy_pet` | `{"name":"Rex","type":"dog","color1":7105644,"color2":14803683}` | Colores (número) deben estar en `Config.petMainColors`/`petDetailColors` en hex. Cobra precio de `Pets`. Crea mascota con id = nº de mascotas + 1. | `player` |
| `delete_pet` | `{"petId":"2"}` | Si tiene más de 1, la borra, reordena ids y pone `currentPet = 1`. | `player` |
| `buy_ammo` | `{"ammoType":"grenade","ammoCount":1}` | Cobra `precio × count`, suma `purchaseAmount × count`. | `player` |
| `set_weapons_equipped` | `{"value":["walk","mortar","grenade"]}` | Válido si posee todas (salvo las gratis: `mortar, superjump, empty, punch, walk, bone, dig, climb, ""`). | `player` |
| `get_medals` | `{}` | — | `{"command":"medal_init"}` |
| `xpromo_fetch` | `{}` | — | `{"command":"xpromo_fetched"}` |
| `news` | `{}` | — | `{"command":"news"}` |
| `idlegift` | `{}` | No da nada. | `{"command":"idlegift"}` |

### 3.1 Login con JWT

El token lo emite tu backend de cuentas; este servidor solo lo verifica (nunca recibe contraseñas):

- Firma **HS256** con el secreto compartido `JWT_SECRET`. Otros algoritmos (incluido `none`) se rechazan.
- `sub` = `id` numérico del usuario en la colección `users` (como texto, p. ej. `"142603"`).
- Se respeta `exp` si viene (recomendado: tokens cortos).
- **Compatibilidad con el cliente SWF original:** el SWF manda `{"command":"logIn","dname":"...","snum":"..."}`.
  Si no hay `token`, el servidor usa `snum` como JWT (y `dname` se ignora: el nombre sale de Mongo). Para el
  SWF, el token se le pasa en el parámetro `snum` de su URL: `publicV1.swf?dname=<nombre>&snum=<jwt>&net=M`.
- Si el token es inválido, expiró o el usuario no existe: **no se responde nada** y queda un `warn` en el log.

Ejemplo de emisión en el backend (Node, `jsonwebtoken`):

```js
jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: "10m" });
```

Notas:
- `quick_play` y `create_game` comparan números con `indexOf`: `10` vale, `"10"` no.
- Formato del id en `quick_play`: `<mapa con guiones>_<jugadores>_<gameDuration ms>_<turnDuration ms>_<n>`.
- Tras `join`, el jugador **todavía no está** en la partida: entra al hacer `start_server_connect` por la
  conexión game (salvo en `join_game`, ver BUGS).

---

## 4. Ladder

| command | Dirección | Efecto |
|---|---|---|
| `ping` | C→S | Responde `{"command":"ping_ack"}` |

Nada más. No hay login ni datos de ranking en este servidor.

### 4.1 Social (frontend web)

No la usa el SWF: es la conexión del frontend (`POST /ballistic/social?x`), con el mismo formato de mensajes.
Sirve para invitar amigos a una partida. Las amistades las guarda el backend de cuentas (colección
`friendships`, ver [CUENTAS.md](CUENTAS.md)).

Todos los mensajes del servidor por esta conexión llevan el formato de respuestas del backend de cuentas:
`{"ok": true, "code": 200, "message": "..."}` además de sus datos, y los errores salen con `command: "error"`:
`{"command":"error","ok":false,"code":409,"message":"Tu amigo no está en el lobby","error":"FRIEND_NOT_IN_LOBBY"}`.
`message` es para mostrar; `error` es un id fijo (lista en `SocialErrorId`, `packages/protocol/src/server.ts`).

| command | Dirección | Efecto |
|---|---|---|
| `logIn` `{token}` | C→S | Con un JWT válido responde `social_ready`; si no, `error` `SESSION_EXPIRED` |
| `ping` | C→S | `ping_ack` |
| `invite` `{to}` | C→S | Invita al amigo con id `to`. Quien invita tiene que estar en el lobby del juego o esperando en su sala privada; el invitado, en el lobby y con el frontend abierto. Al invitado le llega `{"command":"invite","from":{id,dname}}` y a quien invita `invite_sent` `{to}` |
| `invite_answer` `{from, accept}` | C→S | Responde la invitación de `from` (caduca en 1 minuto). Si rechaza, a quien invitó le llega `invite_declined` `{by}`. Si acepta y quien invitó está en su sala privada, al invitado le llega `join` a esa sala (si no está llena); si no, se crea una sala privada de 2 y a los dos SWF les llega `join` por su conexión de lobby (como en `quick_play`). A quien invitó, `invite_accepted` `{by}` |
| `error` | S→C | Algo que mandaste no se pudo: `LOGIN_REQUIRED`, `NOT_FRIENDS`, `FRIEND_NOT_IN_LOBBY`, `INVITE_NOT_FOUND` (caducó o ya se respondió), `ROOM_FULL`… También `INVALID_DATA` si el mensaje no es válido |

---

## 5. Partida (conexión game)

Casi todos los comandos de juego solo se aceptan si el que envía es el **jugador en turno**
(`currentPlayer`) y su avatar **no está bloqueado** (`locked`). Si no, se ignoran.

### 5.1 Entrar

| command | Payload | Efecto |
|---|---|---|
| `start_server_connect` | `{"userId":"Ana"}` (`userId` = `dname`) | Busca en Mongo `{dname: userId, gkey: session de la URL}` y borra el `gkey` en la misma operación: **cada session sirve una sola vez** (para reconectar hay que pedir otro `join` en el lobby). Si no coincide, no responde nada. Si la partida está llena, busca otra igual. Añade al jugador. |

Respuestas, en orden:
1. Al que entra: el `player` de cada otro jugador.
2. A todos: el `player` del que entra.
3. A todos: `game` (2.2).
4. A todos: `game` otra vez con `status:"idle"` (se reinicia la cuenta atrás con cada entrada).

### 5.2 Arranque

El server revisa cada 100 ms. Con **2 o más** jugadores conectados (en partida rápida no hace falta `on_ready`; en una sala privada, la creada con nombre o por invitación, todos tienen que haber mandado `on_ready`):
1. A todos: `game` con `status:"starting"`.
2. 5 s después, a todos: `{"command":"game_join_confirmed"}`.
3. A todos: `startGame`:

```json
{
  "command": "startGame", "randomSeed": 512, "co": ["142603", "142604"],
  "currentPlayer": 142603, "tick": 0,
  "playerlist": [{"...player..."}],
  "positions": [{"id": 142603, "x": 1400, "y": 330}, {"id": 142604, "x": 275, "y": 725}]
}
```

- `randomSeed`: entero 0-999. Los clientes simulan con esta semilla.
- `positions`: sacadas de `Maps.positions` en el orden de entrada.
- Empieza el jugador con el `id` más bajo.

Si alguien sale durante `starting`, vuelve a `idle`.

### 5.3 Reloj y turnos

- El reloj (`tick`) avanza **+10 cada 100 ms** → 1 unidad = 10 ms.
- Duración de turno = `turnDuration` + 2 s el primero, + 1 s los siguientes.
- El `synch_check` del jugador en turno se reenvía a los demás en cuanto llega, con su `tick` (el cliente es
  lockstep: es el reloj de los que no están en turno; ver BUGS.md).
- Al vencer el turno:
  1. Se calcula el fin del nuevo turno y el siguiente jugador pasa a ser `currentPlayer`.
  2. Al jugador **entrante**: `{"command":"set_tick","id":-1,"value":<tick>,"turnEndTick":<tick>,"tick":0}`.
     Se le desbloquea y se le permite disparar de nuevo.
  3. A todos: registro `changeTurn` (2.3).
- Siguiente jugador: el siguiente `id` mayor que esté vivo; si no hay, el menor.
- `turn_complete` del jugador en turno termina su turno en el siguiente tick (máximo 100 ms).
- Al llegar a `gameDuration` (en ticks: `gameDuration / 10`), la partida termina (5.5).

### 5.4 C→S durante la partida

| command | Payload (campos usados) | Requiere turno | Efecto |
|---|---|---|---|
| `ping` | — | no | `ping_ack` al que envía |
| `chat` | cualquiera (`text`…) | no | Reenvía tal cual a los demás |
| `on_ready` | — | no | `player.status = "ready"`; a todos: `game` |
| `not_ready` | — | — | `player.status = "waiting"`. En una sala privada en `starting`, la cuenta atrás se detiene |
| `map_loaded` | — | — | Se ignora |
| `synch_check` | `{"tick":..,"synchCheck":".."}` | sí (sin lock) | Se reenvía tal cual a los demás (5.3) |
| `move_left` / `move_right` / `move_stop` | `{"d":[x,y]}` | sí | Guarda posición; reenvía a los demás |
| `move_jump` | `{"d":[x,y],"direction":"up"}` | sí | Guarda posición; reenvía a los demás |
| `set_aim` | `{"value":"<ángulo>","power":"<n>"}` (el SWF los manda como texto; también se aceptan números) | sí | Reenvía a los demás |
| `start_fire` | `{"d":[x,y]}` | sí | Reenvía a los demás |
| `cancel_fire`, `equip`, `toggle_weapon` | — | sí | Reenvía a los demás |
| `retract_rope`, `release_rope`, `stop_rope`, `detach`, `teleport_stop` | — | sí | Reenvía a los demás |
| `projectile` | `{"d":[x,y],"ammo_type":"grenade","crate":"false"}` | sí (no mira lock) | Ver abajo |
| `turn_complete` | — | sí | Termina el turno en el siguiente tick |
| `position` | `{"x","y","tick"}` | — | Se ignora |
| `request_synch` | — | — | Solo loguea |
| `synch_pts` | `{"value":"<hex>"}` | — | Vida nueva de quien lo manda: cuenta el daño para los premios (5.5) |
| `synchronization` | `{"timeLoop":{..},"avatarList":[{"player":id,"hp":"<hex>",..}],..}` | no | Ver abajo |
| `player_died` | `{"id":142604}` | sí (sin lock) | Marca a ese jugador como muerto. Si no lo envía el jugador en turno, se ignora (`warn` en el log). Una muerte repetida no se cuenta dos veces |
| `exiting` | — | no | Reenvía a los demás |
| `log_projectile` | `{"weapon","x","y","vx","vy"}` | no | Escribe en `logs/<weapon>_xy.txt` y `_vxvy.txt` |
| `damage` | `{"to":"2","from":"1","value":"390","died":"false"}` | — | Se ignora (el SWF lo manda al hacer daño; el original no lo procesaba) |
| `logIn` | — | — | Roto (ver BUGS) |
| `give_medal` | — | — | Roto (ver BUGS) |

**`projectile`**:
1. Si ya disparó este turno: bloquea al avatar y no hace nada más.
2. Busca el arma en `WeaponsGrid`; si no existe, nada.
3. Si `timeAfter` es `null`: el turno termina en 400 unidades (4 s).
   Si `timeAfter > 0`: el turno termina en `timeAfter/10` unidades, y da +1-11 XP y +1-6 de oro.
   (Nunca alarga el turno, solo lo acorta.)
4. Si `crate != "true"`: resta 1 munición.
5. Guarda en Mongo. Al que dispara: `player`. A los demás: el `projectile` tal cual.

**`synchronization`**: lo transforma y lo manda **a todos**:
- `command → "set_synch"`, `id → "oppenheimer"`, `gameRecord → null`.
- `timeLoop.activeAvatar`, `timeLoop.currentTick` y `timeLoop.commandQueue = []` con datos del server.
- En cada avatar, `isWalkingLeft`/`isWalkingRight → "false"`. Si `hp` decodificado es 0, marca muerto al
  jugador, **solo si quien envía es el jugador en turno** (si no, se ignora esa muerte y el `set_synch` se
  manda igual).

### 5.5 Fin de partida

Se revisa cada 100 ms. Termina si quedan ≤ 1 conectados, ≤ 1 vivos o se acabó el tiempo (`gameDuration`):
1. Orden final: los vivos primero (por id; puede haber varios si se acabó el tiempo) y luego los muertos (el
   último en morir antes).
2. Premios (`helpers/rewards.ts`; puesto desde 0), a la mitad si la partida empezó con 2 jugadores:
   - por lugar: XP `9 × (6 − puesto)` y oro `12 × (6 − puesto)`;
   - por eliminación: 15 de XP y 10 de oro. Una muerte cuenta para quien tiene el turno, si no es el muerto;
   - por daño: 1 de XP y 1 de oro cada 100. El daño sale de `synch_pts`: lo que bajó la vida del que lo manda
     (empieza con la de su mascota en Pets.dat) se le acredita a quien tiene el turno, si no es él mismo.
3. A cada uno, `game_stats` con lo suyo (`place` desde 1; los niveles desde 0, como los muestra el cliente):

```json
{"command":"game_stats","players":[142603,142604],"place":2,"damage":350,"kills":0,
 "startLevel":4,"endLevel":4,"startingXP":1200,"endingXP":1231,
 "damageGold":1,"killsGold":0,"placeGold":30,"damageXp":1,"placeXp":22,"killsXp":0}
```

4. A todos: registro `endGame` (2.3).
5. La partida se vacía y vuelve a `idle`.

### 5.6 Desconexión

Se quita al jugador de la partida. Si estaba en `starting` → vuelve a `idle`; si no, a todos: `game`.
Si se fue el jugador en turno, pasa el turno al siguiente.

---

## 6. Resumen S→C

| command | Conexión | Cuándo |
|---|---|---|
| `setPlayer` / `player` | lobby, game | Login, compras, cambios, entrar a partida |
| `ping_ack` | todas | Respuesta a `ping` |
| `join` | lobby | `quick_play`, `create_game`, `join_game` |
| `game_name_return` | lobby | `game_name_check`, `create_game` con nombre ocupado |
| `chance_wheel_return` | lobby | `chance_wheel` |
| `medal_init`, `xpromo_fetched`, `news`, `idlegift` | lobby | Respuestas vacías |
| `game` | game | Cambios de jugadores o estado |
| `game_join_confirmed` | game | Justo antes de `startGame` |
| `startGame` | game | Inicio de partida |
| `synch_check` | game | El del jugador en turno, reenviado a los demás |
| `set_tick` | game | Al jugador que empieza su turno |
| `changeTurn` | game | Cambio de turno |
| `set_synch` | game | Respuesta a `synchronization` |
| `game_stats`, `endGame` | game | Fin de partida |
| (reenvíos) | game | `chat`, `move_*`, `set_aim`, `start_fire`, `projectile`, etc., tal cual |

Definidos en el código pero nunca enviados: `chat` de "Bot", `position`, `request_synch`, `p` (física del
servidor desactivada).
