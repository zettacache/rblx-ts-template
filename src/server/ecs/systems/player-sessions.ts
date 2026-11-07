import { NETWORK_PROTOCOL_VERSION } from "shared/networking";
import { ServerEvents } from "server/networking";
import { playerSessions } from "server/ecs/world";

const Players = game.GetService("Players");

function addPlayer(player: Player) {
	if (player.Parent === Players) playerSessions.add(player);
}

function removePlayer(player: Player) {
	playerSessions.remove(player);
}

export function startPlayerSessions() {
	const connections = [
		Players.PlayerAdded.Connect(addPlayer),
		Players.PlayerRemoving.Connect(removePlayer),
		ServerEvents.clientReady.connect((player, protocolVersion) => {
			if (protocolVersion !== NETWORK_PROTOCOL_VERSION || player.Parent !== Players) return;

			playerSessions.queueReady(player);
		}),
	];

	for (const player of Players.GetPlayers()) addPlayer(player);

	return () => {
		for (const connection of connections) connection.Disconnect();
		playerSessions.clear();
	};
}

export function processPlayerSessions() {
	playerSessions.step((player) => {
		if (player.Parent === Players) ServerEvents.sessionReady.fire(player, player.UserId);
	});
}
