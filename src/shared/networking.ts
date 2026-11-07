import { Networking } from "@flamework/networking";

export const NETWORK_PROTOCOL_VERSION = 1;

interface ClientToServerEvents {
	clientReady(protocolVersion: number): void;
}

interface ServerToClientEvents {
	sessionReady(userId: number): void;
}

export const GlobalEvents = Networking.createEvent<ClientToServerEvents, ServerToClientEvents>();
