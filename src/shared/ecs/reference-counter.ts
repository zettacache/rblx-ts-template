import type { Entity } from "@rbxts/jecs";
import type { createPlayerSessions } from "shared/ecs/player-sessions";
import { COUNTER_COOLDOWN_SECONDS, COUNTER_LIMIT } from "shared/reference-counter-config";

/** Uses the session world; transport, clock and presentation stay outside simulation state. */
export function createReferenceCounter<K>(sessions: ReturnType<typeof createPlayerSessions<K>>) {
	const { simulationWorld: world, PlayerRef, ClientReady } = sessions;
	const Count = world.component<number>();
	const pending = new Map<K, { entity: Entity; revision: number }>();
	const nextAllowed = new Map<K, number>();
	function queue(key: K, revision: number, now: number) {
		const entity = sessions.getEntity(key);
		if (entity === undefined || !world.has(entity, ClientReady)) return false;
		const count = world.get(entity, Count);
		if (
			count === undefined ||
			count >= COUNTER_LIMIT ||
			revision !== count ||
			pending.has(key) ||
			now < (nextAllowed.get(key) ?? 0)
		)
			return false;
		pending.set(key, { entity, revision });
		nextAllowed.set(key, now + COUNTER_COOLDOWN_SECONDS);
		return true;
	}
	function step(publish: (key: K, count: number) => void) {
		for (const [entity, key] of world.query(PlayerRef, ClientReady)) {
			if (!world.has(entity, Count)) {
				world.set(entity, Count, 0);
				publish(key, 0);
			}
		}
		for (const [key, command] of pending) {
			pending.delete(key);
			const entity = sessions.getEntity(key);
			if (entity !== command.entity || !world.has(entity, ClientReady)) continue;
			const count = world.get(entity, Count);
			if (count === undefined || count !== command.revision || count >= COUNTER_LIMIT) continue;
			world.set(entity, Count, count + 1);
			publish(key, count + 1);
		}
	}
	function remove(key: K) {
		pending.delete(key);
		nextAllowed.delete(key);
	}
	function clear() {
		pending.clear();
		nextAllowed.clear();
	}
	return { Count, queue, step, remove, clear, pendingCount: () => pending.size() };
}
