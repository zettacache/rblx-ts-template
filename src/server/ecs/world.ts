import { createPlayerSessions } from "shared/ecs/player-sessions";

export const playerSessions = createPlayerSessions<Player>();
export const { simulationWorld, PlayerRef, ClientReady } = playerSessions;
