// Lobby: tienda (armas, accesorios, mascotas), ruleta y equipamiento. Los precios salen de los .dat
import type LobbyClient = require("../client/client.lobby.js");
import type WOL = require("../wol");
import type { LobbyMessage } from "wildones-protocol";
import log = require("../helpers/log.js");

type Msg<C> = Extract<LobbyMessage, { command: C }>;

export function handleNewPlayerFlag(client: LobbyClient): void {
  client.player.nw = -1;
  client.updatePlayerData();
}

export function handlePetModification(client: LobbyClient, data: Msg<"modify_pet">): void {
  if (!client.player) log.warn("modify_pet sin datos de jugador");
  if (!client.player.ownedPets[data.petid]) {
    log.warn({ petid: data.petid }, "modify_pet: mascota inexistente");
    return;
  }

  client.player.ownedPets[data.petid].color1 = data.color1;
  client.player.ownedPets[data.petid].color2 = data.color2;
  client.player.ownedPets[data.petid].name = data.name;
  client.updatePlayerData();
}

export function handleChanceWheel(client: LobbyClient): void {
  if (client.connectionType == "lobby") {
    client.sendPacket({
      command: "chance_wheel_return",
      value: client.getReward(),
    });
  }
}

export function handleChangePet(client: LobbyClient, data: Msg<"change_pet">): void {
  if (!client.ownsPet(data.name)) return;

  client.player.currentPet = data.name;
  client.sendUpdate();
  client.updatePlayerData();
}

export function handleBuyAccessory(client: LobbyClient, data: Msg<"buy_accessory">, wol: WOL): void {
  if (client.connectionType != "lobby") return;

  const type = data.type;

  if (!wol.accessoriesObj[type]) {
    log.warn({ type }, "buy_accessory: accesorio inexistente");
    return;
  }

  if (wol.accessoriesObj[type].currency == "treats") {
    if (client.chargeTreats(wol.accessoriesObj[type].price as number)) {
      client.player.userAccessories.push(type);
      client.sendUpdate();
      client.updatePlayerData();
    } else {
      log.debug({ type }, "buy_accessory: sin treats");
    }
  } else {
    if (client.chargeGold(wol.accessoriesObj[type].price as number)) {
      client.player.userAccessories.push(type);
      client.sendUpdate();
      client.updatePlayerData();
    } else {
      log.debug({ type }, "buy_accessory: sin oro");
    }
  }
}

export function handleAccLoad(client: LobbyClient, data: Msg<"set_acc_load">, wol: WOL): void {
  if (client.connectionType != "lobby") return;

  // Todos tienen que ser suyos y existir, y uno por categoría (cabeza, cuerpo...)
  const categories = data.load.map((item) => wol.accessoriesObj[item]?.category);
  const valid =
    data.load.every((item) => client.player.userAccessories.indexOf(item) >= 0 && wol.accessoriesObj[item]) &&
    new Set(categories).size == categories.length;

  if (valid) {
    client.player.ownedPets[client.player.currentPet].accessories = data.load;
    client.sendUpdate();
    client.updatePlayerData();
  } else {
    log.warn({ dname: client.player.dname, load: data.load }, "set_acc_load: combinación inválida");
    //log event
  }
}

export function handleBuyPet(client: LobbyClient, data: Msg<"buy_pet">, wol: WOL): void {
  if (client.connectionType != "lobby") return;
  if (!data.name) return;

  if (
    wol.config.petDetailColors.indexOf(data.color2.toString(16)) < 0 ||
    wol.config.petMainColors.indexOf(data.color1.toString(16)) < 0
  ) {
    log.warn({ dname: client.player.dname }, "buy_pet: color no permitido");
    return;
  }

  if (!wol.petsObj[data.type]) {
    log.warn({ type: data.type }, "buy_pet: mascota inexistente");
    return;
  }

  if (wol.petsObj[data.type].currency == "treats") {
    if (!client.chargeTreats(parseInt(String(wol.petsObj[data.type].price)))) {
      log.debug("buy_pet: sin treats");
      return;
    }
  } else {
    if (!client.chargeGold(parseInt(String(wol.petsObj[data.type].price)))) {
      log.debug("buy_pet: sin oro");
      return;
    }
  }


  const petInfo = {
    id: Object.keys(client.player.ownedPets).length + 1,
    gender: "M",
    name: data.name,
    color1: data.color1,
    color2: data.color2,
    kills: 0,
    deaths: 0,
    type: data.type,
    pers: "physicist",
    accessories: [],
  };

  client.player.ownedPets[petInfo["id"]] = petInfo;
  client.sendUpdate();
  client.updatePlayerData();
}

export function handleDeletePet(client: LobbyClient, data: Msg<"delete_pet">): void {
  if (client.connectionType != "lobby") return;
  if (!data.petId) return;

  const len = Object.keys(client.player.ownedPets).length + 1;

  if (len <= 2) return;

  // Corre las mascotas siguientes una posición hacia abajo y borra la última
  for (let i = parseInt(String(data.petId)); i < len - 1; i++) {
    if (client.player.ownedPets[i] && client.player.ownedPets[i + 1]) {
      client.player.ownedPets[i] = client.player.ownedPets[i + 1];
      client.player.ownedPets[i].id = i;
    }
  }

  delete client.player.ownedPets[len - 1];
  client.player.currentPet = "1"; // como en change_pet y el registro: texto
  client.sendUpdate();
  client.updatePlayerData();
}

export function handleBuyAmmo(client: LobbyClient, data: Msg<"buy_ammo">, wol: WOL): void {
  if (client.connectionType != "lobby") return;

  const type = data.ammoType;
  const count = data.ammoCount;

  if (!wol.weaponsObj[type]) {
    log.warn({ type }, "buy_ammo: arma inexistente");
    return;
  }

  if (!count) return;

  //also check for level

  // Cantidad que se suma: purchaseAmount × count (o count si el arma no tiene purchaseAmount)
  const weapon = wol.weaponsObj[type];
  const amount = weapon.purchaseAmount ? parseInt(String(weapon.purchaseAmount)) * data.ammoCount : data.ammoCount;
  const paid =
    weapon.currency == "treats"
      ? client.chargeTreats((weapon.price as number) * data.ammoCount)
      : client.chargeGold((weapon.price as number) * data.ammoCount);

  if (paid) {
    if (client.player.userWeaponsOwned[type]) client.player.userWeaponsOwned[type] += amount;
    else client.player.userWeaponsOwned[type] = amount;

    client.sendUpdate();
    client.updatePlayerData();
  } else {
    log.debug({ type, currency: weapon.currency }, "buy_ammo: sin dinero");
  }
}

// Armas gratis (no hace falta tenerlas): las de Levels.dat nivel 0 y el poder de cada mascota del jugador
function freeWeapons(client: LobbyClient, wol: WOL): string[] {
  const levels = wol.levelsObj as { weapon?: string[] }[];
  const pets = Object.values(client.player.ownedPets) as { type: string }[];
  const powers = pets.map((pet) => wol.petsObj[pet.type]?.petPower);
  return ["empty", "", ...(levels[0]?.weapon ?? []), ...powers];
}

export function handleSetWeaponsEquipped(client: LobbyClient, data: Msg<"set_weapons_equipped">, wol: WOL): void {
  const free = freeWeapons(client, wol);
  let validSet = true;
  for (let i = 0; i < data.value.length; i++) {
    if (free.includes(data.value[i])) continue;

    if (!client.player.userWeaponsOwned[data.value[i]]) {
      log.warn({ weapon: data.value[i] }, "set_weapons_equipped: arma que no tiene");
      validSet = false;
      break;
    }
  }

  if (!validSet) return;

  client.player.userWeaponsEquipped = data.value;
  client.sendUpdate();
  client.updatePlayerData();
}
