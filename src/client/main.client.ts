import { ClientEvents } from "client/networking";
import { NETWORK_PROTOCOL_VERSION } from "shared/networking";

const Players = game.GetService("Players");

const readyConnection = ClientEvents.sessionReady.connect((userId) => {
	if (userId !== Players.LocalPlayer.UserId) return;

	print(`[Game] Session ready for ${userId}; networking and ECS handshake succeeded.`);
	if (game.GetService("RunService").IsStudio()) script.SetAttribute("HandshakeSucceeded", true);
	readyConnection.Disconnect();
});

// Subscribe before sending so the server's reply cannot race the listener.
ClientEvents.clientReady.fire(NETWORK_PROTOCOL_VERSION);
