// Acceso a MongoDB, colección `users`. Las operaciones no esperan respuesta: avisan por callback.
import { MongoClient, type Db, type Filter } from "mongodb";
import type { UserDoc } from "./types";
import log = require("./helpers/log.js");

const url = process.env.MONGO_URL || "mongodb://localhost:27017/emu";

let database: Db;

class Database {
  connect(): void {
    // Si no conecta, la promesa rechazada sin catch tumba el proceso (como el assert de antes)
    MongoClient.connect(url).then(function (client) {
      log.info("Conectado a MongoDB");
      database = client.db();
      // Recién arrancado nadie está conectado (por si el servidor se cayó con jugadores dentro)
      database
        .collection<UserDoc>("users")
        .updateMany({ presence: { $ne: "offline" } }, { $set: { presence: "offline" } })
        .catch(function () {});
    });
  }

  update(condition: Filter<UserDoc>, data: Partial<UserDoc>): void {
    database
      .collection<UserDoc>("users")
      .updateOne(condition, { $set: data })
      .catch(function () {});
  }

  count(condition: Filter<UserDoc>, callback: (n?: number) => void): void {
    database
      .collection<UserDoc>("users")
      .countDocuments(condition)
      .then(callback, function () {
        callback();
      });
  }

  // Busca al usuario con ese pase de partida y lo borra en la misma operación (atómica): dos conexiones con
  // el mismo pase no pueden entrar las dos
  consumeGameKey(dname: string, gkey: string, callback: (doc: UserDoc | null) => void): void {
    database
      .collection<UserDoc>("users")
      .findOneAndUpdate({ dname, gkey }, { $set: { gkey: null } })
      .then(callback, function () {
        callback(null);
      });
  }

  // ¿Son amigos? Lee la colección "friendships" del backend de cuentas (una por pareja: pair = "menor-mayor")
  areFriends(a: number, b: number, callback: (friends: boolean) => void): void {
    const pair = a < b ? `${a}-${b}` : `${b}-${a}`;
    database
      .collection("friendships")
      .countDocuments({ pair, status: "accepted" })
      .then(
        (n) => callback(n > 0),
        () => callback(false),
      );
  }

  fetch(condition: Filter<UserDoc>, callback: (doc: UserDoc | null) => void): void {
    database
      .collection<UserDoc>("users")
      .findOne(condition)
      .then(callback, function () {
        callback(null);
      });
  }
}

export = Database;
