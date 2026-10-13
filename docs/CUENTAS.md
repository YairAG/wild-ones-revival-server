# Contrato con el backend de cuentas

El backend de cuentas (registro, login, contraseñas) **no está en este repo**: es un proyecto aparte. Este
documento dice lo que el servidor de juego espera de él. Si el backend cumple esto, los jugadores pueden entrar.

## Resumen

```
Frontend ──(usuario + contraseña)──▶ Backend de cuentas ──▶ crea/lee el usuario en Mongo
Frontend ◀──────────(JWT)──────────── Backend de cuentas
Frontend ──(WebSocket: logIn {token})──▶ Servidor de juego ──▶ verifica el JWT y lee el usuario en Mongo
```

El backend y el servidor de juego comparten **la misma base de MongoDB** (`MONGO_URL`) y **el mismo secreto**
(`JWT_SECRET`). No se hablan entre sí directamente.

## 1. El JWT

| Campo | Valor |
|---|---|
| Algoritmo | **HS256** (cualquier otro, incluido `none`, se rechaza) |
| Secreto | `JWT_SECRET`, el mismo en los dos `.env` |
| `sub` | El `id` numérico del usuario, como texto: `"142603"` |
| `exp` | Recomendado y corto (p. ej. 10 minutos): el token solo se usa al hacer `logIn` |

```js
// Backend (Node, jsonwebtoken)
const token = jwt.sign({}, process.env.JWT_SECRET, { subject: String(user.id), expiresIn: "10m" });
```

El frontend lo manda al servidor de juego en el primer mensaje del lobby:
`{"command":"logIn","token":"<jwt>"}` (ver [PROTOCOL.md](PROTOCOL.md), sección 3.1).

Si el token es inválido, expiró o el usuario no existe, el servidor **no responde nada** (queda un `warn` en su
log). El frontend debería tratar "sin respuesta en unos segundos" como login fallido y pedir un token nuevo.

## 2. El documento de usuario (colección `users`)

El backend lo crea al registrar a alguien. Ejemplo completo: [user-schema.example.json](../apps/server/user-schema.example.json).

### Campos que el servidor necesita

| Campo | Tipo | Notas |
|---|---|---|
| `id` | número | **Único.** Es el `sub` del JWT. No sirve el `_id` (ObjectId) de Mongo: tiene que ser un número |
| `dname` | texto | Nombre visible. **Único**: la entrada a la partida busca por `dname` |
| `gold`, `treats`, `xp`, `level` | número | Oro, treats (moneda premium), experiencia, nivel |
| `currentPet` | texto | Clave de `ownedPets` de la mascota activa (p. ej. `"1"`). **Tiene que existir** en `ownedPets` |
| `ownedPets` | objeto | `{ "1": { id, name, type, gender, pers, color1, color2, kills, deaths, accessories: [] } }` |
| `userWeaponsOwned` | objeto | Munición por arma: `{ "grenade": 3 }`. Puede empezar vacío |
| `userWeaponsEquipped` | lista | Armas en la barra. Las gratis: `walk`, `bone`, `superjump`, `climb`, `punch`, `dig`, `mortar` |
| `userAccessories` | lista | Accesorios comprados |
| `durability` | objeto | Durabilidad de accesorios. Puede empezar vacío |
| `allowedMaps` | lista | Mapas desbloqueados |
| `nw` | número | `-1` si ya no es jugador nuevo (el cliente lo cambia con `setNewPlayerFlag`) |
| `hp`, `speed`, `attack`, `defence`, `jump` | número | Stats que se envían al cliente |
| `wins`, `losses`, `gamecount`, `sesscount`, `login_streak` | número | Estadísticas |
| `status`, `playerStatus`, `net` | texto | Se copian tal cual al cliente |

Los valores iniciales (cuánto oro, qué mascota, qué armas) son decisiones de diseño del juego: el servidor no
los valida al crear el usuario.

### Campos que escribe el servidor

- Todos los de la tabla anterior, con `$set`, cuando el jugador compra, gana XP/oro o cambia algo. **Los demás
  campos del documento no los toca.** También agrega `command` y `online` (ver BUGS).
- `gkey`: el pase de un solo uso para entrar a una partida. Lo crea y lo borra el servidor; el backend no debe
  tocarlo.
- `presence`: dónde está el jugador ahora: `"playing"` (en una partida), `"lobby"` (solo en el lobby) u
  `"offline"`. Se actualiza al entrar o salir del lobby o de una partida, y al arrancar el servidor todos pasan a
  `"offline"`. El backend puede leerlo (p. ej. para la lista de amigos) pero no debe escribirlo. Si no existe,
  el jugador nunca se ha conectado: tratarlo como `"offline"`. No confundir con `status`, que es la marca de
  "listo" de la sala que usa el cliente original.

### Amistades (colección `friendships`)

Las escribe solo el backend de cuentas. El servidor de juego solo las **lee** para las invitaciones a partida
(conexión social, ver PROTOCOL.md): dos jugadores son amigos si existe
`{ pair: "<id menor>-<id mayor>", status: "accepted" }`.

### Lo que el servidor nunca lee

Contraseñas, emails, fechas de registro, etc. Recomendación: guárdalos en **otra colección** (p. ej.
`accounts`, con `{ userId, email, passwordHash }`), así quedan separados de lo que el servidor de juego escribe.
Contraseñas siempre con hash (argon2 o bcrypt), nunca en texto.

## 3. Ids numéricos

Para que cada usuario tenga un `id` numérico único y consecutivo, un contador atómico en Mongo:

```js
// Driver mongodb 6+: devuelve el documento ya actualizado (1, 2, 3, ...)
const counter = await db.collection("counters").findOneAndUpdate(
  { _id: "userId" },
  { $inc: { seq: 1 } },
  { upsert: true, returnDocument: "after" },
);
const id = counter.seq;
```

## 4. Índices recomendados

```js
db.collection("users").createIndex({ id: 1 }, { unique: true });
db.collection("users").createIndex({ dname: 1 }, { unique: true });
```

## 5. Configuración compartida

| Variable | Backend | Servidor de juego |
|---|---|---|
| `MONGO_URL` | La misma base | La misma base |
| `JWT_SECRET` | Firma los tokens | Los verifica |

El frontend necesita la URL del backend (HTTP) y la del servidor de juego (`ws://host:WS_PORT`).
