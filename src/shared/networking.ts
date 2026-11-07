import { Networking } from "@flamework/networking";

export const NETWORK_PROTOCOL_VERSION = 2;

interface ClientToServerEvents {
	clientReady(protocolVersion: number): void;
	incrementCounter(protocolVersion: number, expectedRevision: number): void;
}

interface ServerToClientEvents {
	sessionReady(userId: number): void;
	counterSnapshot(protocolVersion: number, count: number): void;
}

export const GlobalEvents = Networking.createEvent<ClientToServerEvents, ServerToClientEvents>();
