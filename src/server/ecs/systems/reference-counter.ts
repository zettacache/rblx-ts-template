import { playerSessions } from "server/ecs/world";
import { ServerEvents } from "server/networking";
import { createReferenceCounter } from "shared/ecs/reference-counter";
import { NETWORK_PROTOCOL_VERSION } from "shared/networking";
import { REFERENCE_COUNTER_ENABLED } from "shared/reference-counter-config";

const Players = game.GetService("Players");
export const referenceCounter = createReferenceCounter(playerSessions);

export function startReferenceCounter() {
	if (!REFERENCE_COUNTER_ENABLED) return () => {};
	const connections = [
		ServerEvents.incrementCounter.connect((player, protocol, revision) => {
			if (protocol !== NETWORK_PROTOCOL_VERSION || player.Parent !== Players) return;
			// Equality to the bounded authoritative count also rejects NaN/infinity/fractions.
			referenceCounter.queue(player, revision, os.clock());
		}),
		Players.PlayerRemoving.Connect((player) => referenceCounter.remove(player)),
	];
	return () => {
		for (const connection of connections) connection.Disconnect();
		referenceCounter.clear();
	};
}

export function processReferenceCounter() {
	if (!REFERENCE_COUNTER_ENABLED) return;
	referenceCounter.step((player, count) => {
		if (player.Parent === Players) ServerEvents.counterSnapshot.fire(player, NETWORK_PROTOCOL_VERSION, count);
	});
}
