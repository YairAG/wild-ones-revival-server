# wildones-protocol

Tipos de TypeScript y esquemas [Zod](https://zod.dev) de los mensajes entre cliente y servidor de
[Wild Ones Revival](https://github.com/YairAG/Wild-Ones-Revival). El protocolo completo está documentado en
[docs/PROTOCOL.md](https://github.com/YairAG/Wild-Ones-Revival/blob/develop/docs/PROTOCOL.md).

    pnpm add wildones-protocol

## Uso

```ts
import { lobbyMessage, type LobbyMessage, type ServerMessage, type Player } from "wildones-protocol";

// Tipar lo que envías al servidor
const login: LobbyMessage = { command: "logIn", token: jwt };

// Validar antes de enviar (o lo que recibes, si lo necesitas)
lobbyMessage.parse({ command: "buy_ammo", ammoType: "grenade", ammoCount: 1 });

// Tipar lo que responde el servidor
function onMessage(msg: ServerMessage) {
  if (msg.command === "setPlayer" || msg.command === "player") showPlayer(msg as Player);
}
```

## Qué exporta

| Exportación | Qué es |
|---|---|
| `lobbyMessage`, `ladderMessage`, `gameMessage` | Esquemas Zod de lo que el cliente envía, por tipo de conexión |
| `LobbyMessage`, `LadderMessage`, `GameMessage`, `ClientMessage` | Sus tipos |
| `ServerMessage` | Todo lo que el servidor puede enviar |
| `Player`, `Pet`, `GameState`, `GameRecord`, `StartGame`, `GameStats`, `GameStatus` | Objetos que se repiten en los mensajes del servidor |

Los mensajes viajan como 6 dígitos de longitud **en bytes** (UTF-8) + JSON (`000018{"command":"ping"}`), por
WebSocket o TCP.
Este paquete solo describe el JSON; el formato de transporte está en `PROTOCOL.md`.

Licencia MIT.
