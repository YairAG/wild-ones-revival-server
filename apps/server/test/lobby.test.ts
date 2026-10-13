// Tests de caracterización del lobby: tienda, mascotas, ruleta, popups y salas con nombre.
// Fijan el comportamiento de HOY, bugs incluidos (marcados con "bug:"). Ver docs/TESTS.md.
import { describe, test, before, after } from "node:test";
import assert = require("node:assert/strict");
import { startTestServer, user, TRANSPORTS, type TestEnv } from "./helpers/server";
import type { Message, TestClient, Transport } from "./helpers/client";

function suite(transport: Transport) {
  let env: TestEnv, caro: TestClient;
  const last = (responses: Message[]) => responses.filter((m) => m.command === "player").at(-1)!;

  before(async () => {
    env = await startTestServer([user(10, "Caro", { nw: 0 }), user(11, "Dani"), user(12, "Eva")], transport);
    caro = await env.login("Caro");
  });

  after(() => env?.stop());

  test("setNewPlayerFlag guarda nw = -1 y no responde", async () => {
    assert.deepEqual(await caro.request({ command: "setNewPlayerFlag" }), []);
    await env.waitForUser("Caro", (u) => u.nw === -1);
  });

  test("modify_pet cambia nombre y colores y no responde", async () => {
    const msg = { command: "modify_pet", petid: "1", color1: "0x111111", color2: "0x222222", name: "Max" };
    assert.deepEqual(await caro.request(msg), []);
    const doc = await env.waitForUser("Caro", (u) => u.ownedPets["1"].name === "Max");
    assert.equal(doc.ownedPets["1"].color1, "0x111111");
  });

  test("comandos de popups responden un mensaje vacío; dname se ignora", async () => {
    assert.deepEqual(await caro.request({ command: "get_medals" }), [{ command: "medal_init" }]);
    assert.deepEqual(await caro.request({ command: "xpromo_fetch" }), [{ command: "xpromo_fetched" }]);
    assert.deepEqual(await caro.request({ command: "news" }), [{ command: "news" }]);
    assert.deepEqual(await caro.request({ command: "idlegift" }), [{ command: "idlegift" }]);
    assert.deepEqual(await caro.request({ command: "dname" }), []);
  });

  test("buy_ammo cobra precio × cantidad y suma purchaseAmount × cantidad", async () => {
    // grenade: 10 de oro, purchaseAmount 2
    const r = await caro.request({ command: "buy_ammo", ammoType: "grenade", ammoCount: 2 });
    assert.equal(r.length, 2); // un "player" al cobrar y otro al sumar
    assert.equal(last(r).gold, 980);
    assert.equal(last(r).userWeaponsOwned.grenade, 4);

    // goo: 3 treats, sin purchaseAmount (vale 1 por defecto)
    const r2 = await caro.request({ command: "buy_ammo", ammoType: "goo", ammoCount: 1 });
    assert.equal(last(r2).treats, 197);
    assert.equal(last(r2).userWeaponsOwned.goo, 1);

    // arma inexistente o sin dinero: nada
    assert.deepEqual(await caro.request({ command: "buy_ammo", ammoType: "nuke", ammoCount: 1 }), []);
    assert.deepEqual(await caro.request({ command: "buy_ammo", ammoType: "grenade", ammoCount: 1000 }), []);
  });

  test("buy_accessory y set_acc_load", async () => {
    const r = await caro.request({ command: "buy_accessory", type: "Gorro" });
    assert.equal(last(r).gold, 930);
    assert.deepEqual(last(r).userAccessories, ["Gorro"]);

    const r2 = await caro.request({ command: "set_acc_load", load: ["Gorro"] });
    assert.deepEqual(last(r2).ownedPets["1"].accessories, ["Gorro"]);

    // dos veces el mismo accesorio: se rechaza
    assert.deepEqual(await caro.request({ command: "set_acc_load", load: ["Gorro", "Gorro"] }), []);
    // uno que no tiene: se rechaza
    assert.deepEqual(await caro.request({ command: "set_acc_load", load: ["Capa"] }), []);
  });

  test("buy_pet, change_pet y delete_pet", async () => {
    // colores como número; se comparan en hex contra Config.petMainColors / petDetailColors
    const pet = { command: "buy_pet", name: "Michi", type: "cat", color1: 0x6c6c6c, color2: 0xe1e2e3 };
    const r = await caro.request(pet);
    assert.equal(last(r).gold, 830);
    assert.deepEqual(last(r).ownedPets["2"], {
      id: 2, gender: "M", name: "Michi", color1: 0x6c6c6c, color2: 0xe1e2e3,
      kills: 0, deaths: 0, type: "cat", pers: "physicist", accessories: [],
    });

    // color no permitido: nada
    assert.deepEqual(await caro.request({ ...pet, color1: 0x123456 }), []);

    // con la mascota, su poder (petPower) se puede equipar sin tenerlo en userWeaponsOwned
    const equip = await caro.request({ command: "set_weapons_equipped", value: ["walk", "mortar", "scratch"] });
    assert.deepEqual(last(equip).userWeaponsEquipped, ["walk", "mortar", "scratch"]);

    const r2 = await caro.request({ command: "change_pet", name: "2" });
    assert.equal(last(r2).currentPet, "2");
    assert.deepEqual(await caro.request({ command: "change_pet", name: "9" }), []); // no la tiene

    const r3 = await caro.request({ command: "delete_pet", petId: "2" });
    assert.deepEqual(Object.keys(last(r3).ownedPets), ["1"]);
    assert.equal(last(r3).currentPet, "1"); // vuelve a la 1 (texto, como en change_pet)
    assert.deepEqual(await caro.request({ command: "delete_pet", petId: "1" }), []); // no se borra la última
  });

  test("set_weapons_equipped", async () => {
    const r = await caro.request({ command: "set_weapons_equipped", value: ["walk", "grenade", "goo"] });
    assert.deepEqual(last(r).userWeaponsEquipped, ["walk", "grenade", "goo"]);

    // Con un arma que no tiene no cambia nada (antes además lanzaba ReferenceError y se perdía el resto del
    // paquete TCP; ahora el ping de request() sí llega)
    assert.deepEqual(await caro.request({ command: "set_weapons_equipped", value: ["nuke"] }), []);
    assert.ok(env.logs().some((l) => l.msg === "set_weapons_equipped: arma que no tiene" && l.weapon === "nuke"));
  });

  test("chance_wheel cobra 2 treats y da un arma", async () => {
    const r = await caro.request({ command: "chance_wheel" });
    const wheel = r.find((m) => m.command === "chance_wheel_return")!;
    const [[weapon, amount]] = Object.entries(wheel.value.reward as Record<string, number>);
    assert.ok(["teleport", "grappling", "grenade", "flamethrower", "goo", "mirv", "drill", "lasercannon"].includes(weapon));
    assert.ok(amount >= 1);
    assert.ok(["true", "false"].includes(wheel.value.special));
    assert.equal(last(r).treats, 195);
  });

  test("salas con nombre: game_name_check, create_game y join_game", async () => {
    const check = (name: string) => caro.request({ command: "game_name_check", name });
    assert.deepEqual(await check("Sala 1"), [{ command: "game_name_return", name: "Sala 1", value: 1 }]);
    assert.deepEqual(await check("Sala!"), []); // caracteres no permitidos: nada

    const details = { mapName: "Sink or Swim", playerCount: 2, gameDuration: 1, turnDuration: 10 };
    const [join] = await caro.request({ command: "create_game", gameName: "Sala 1", ...details });
    assert.equal(join.command, "join");
    assert.equal(join.id, "Sala-1"); // espacios → guiones

    // game_name_check convierte los espacios igual que create_game: "Sala 1" ya está ocupada
    assert.equal((await check("Sala 1"))[0].value, 0);
    assert.equal((await check("Sala-1"))[0].value, 0);

    // crear otra con el mismo nombre: avisa que está ocupado
    assert.deepEqual(await caro.request({ command: "create_game", gameName: "Sala 1", ...details }), [
      { command: "game_name_return", name: "Sala-1", value: 0 },
    ]);

    // join_game solo da la llave (session); la conexión de lobby no entra a la partida
    const dani = await env.login("Dani");
    const [joinDani] = await dani.request({ command: "join_game", gameName: "Sala 1" });
    assert.equal(joinDani.id, "Sala-1");
    assert.equal(joinDani.playerCount, 0);
    assert.ok(joinDani.session);

    // sala inexistente: nada
    const eva = await env.login("Eva");
    assert.deepEqual(await eva.request({ command: "join_game", gameName: "No existe" }), []);
  });
}

for (const transport of TRANSPORTS) describe(transport, () => suite(transport));
