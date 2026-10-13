// Cliente mínimo que habla el protocolo del servidor (ver docs/PROTOCOL.md).
import net = require("net");
import { WebSocket } from "ws";

export type Transport = "tcp" | "ws";

const HEADER = "Originality is undetected plagiarism.\r\n\r\n";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mensaje recibido: JSON arbitrario del servidor (en los tests se leen campos sueltos sin tiparlos)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Message = { command: string; [key: string]: any };

class TestClient {
  port: number;
  path: string;
  buffer = Buffer.alloc(0); // en bytes, como el SWF
  messages: Message[] = []; // mensajes recibidos y aún no consumidos con next()
  sawHeader = false;
  socket!: net.Socket;
  ws!: WebSocket;
  transport: Transport;
  binary: boolean; // ws: mandar frames binarios (como Ruffle) en vez de texto
  receivedBinary = false; // ws: si la última respuesta llegó en un frame binario

  // path: "/ballistic/lobby?session=x", "/ballistic/game?gameId=..&session=..", etc.
  constructor(port: number, path: string, transport: Transport = "tcp", binary = false) {
    this.port = port;
    this.path = path;
    this.transport = transport;
    this.binary = binary;
  }

  connect(): Promise<void> {
    if (this.transport === "ws") return this.connectWs();
    return new Promise((resolve, reject) => {
      this.socket = net.connect(this.port, "127.0.0.1", () => {
        this.socket.write(`POST ${this.path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        resolve();
      });
      this.socket.on("error", reject);
      this.socket.on("data", (data) => this.onData(Buffer.from(data)));
    });
  }

  // WebSocket: el mismo POST inicial y los mismos mensajes que por TCP, cada uno en un mensaje WebSocket
  connectWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}`);
      this.ws.on("open", () => {
        this.write(`POST ${this.path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        resolve();
      });
      this.ws.on("error", reject);
      this.ws.on("message", (data, isBinary) => {
        this.receivedBinary = isBinary;
        this.onData(Buffer.from(data as Buffer));
      });
    });
  }

  write(text: string): void {
    if (this.transport === "tcp") this.socket.write(text);
    else this.ws.send(this.binary ? Buffer.from(text) : text);
  }

  send(message: object): void {
    const json = JSON.stringify(message);
    this.write(String(Buffer.byteLength(json)).padStart(6, "0") + json); // longitud en bytes, como el SWF
  }

  onData(data: Buffer): void {
    if (data.toString().startsWith(HEADER)) {
      this.sawHeader = true;
      data = data.subarray(Buffer.byteLength(HEADER));
    }
    this.buffer = Buffer.concat([this.buffer, data]);
    // Saca todos los mensajes completos: 6 dígitos de longitud (en bytes) + JSON
    while (this.buffer.length >= 6) {
      const len = Number(this.buffer.subarray(0, 6).toString());
      if (this.buffer.length < 6 + len) break;
      this.messages.push(JSON.parse(this.buffer.subarray(6, 6 + len).toString()));
      this.buffer = this.buffer.subarray(6 + len);
    }
  }

  // Espera el siguiente mensaje con ese command. Descarta los anteriores a él.
  async next(command: string, timeout = 3000): Promise<Message> {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const i = this.messages.findIndex((m) => m.command === command);
      if (i >= 0) return this.messages.splice(0, i + 1).pop()!;
      await sleep(20);
    }
    throw new Error(`No llegó "${command}" en ${timeout} ms`);
  }

  // Envía un mensaje y devuelve todo lo que respondió el servidor. Manda detrás un ping de control:
  // el servidor atiende en orden, así que al llegar el ping_ack ya respondió al mensaje.
  async request(message: { command: string; [key: string]: unknown }): Promise<Message[]> {
    this.messages.length = 0;
    this.send(message);
    this.send({ command: "ping" });
    const end = Date.now() + 3000;
    while (!this.messages.some((m) => m.command === "ping_ack")) {
      if (Date.now() > end) throw new Error(`Sin respuesta a "${message.command}"`);
      await sleep(20);
    }
    const i = this.messages.findIndex((m) => m.command === "ping_ack");
    return this.messages.splice(0, i + 1).slice(0, -1);
  }

  close(): void {
    if (this.transport === "tcp") this.socket.destroy();
    else this.ws.terminate();
  }
}

export { TestClient, sleep };
export type { Message };
