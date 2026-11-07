import { world } from "@rbxts/jecs";
import type { Entity } from "@rbxts/jecs";

/** Owns session entities without depending on networking or Roblox services. */
export function createPlayerSessions<K>() {
	const simulationWorld = world();
	const PlayerRef = simulationWorld.component<K>();
	const ClientReady = simulationWorld.entity();
	const entities = new Map<K, Entity>();
	const pending = new Set<K>();
	function add(key: K) {
		const existing = entities.get(key);
		if (existing !== undefined) return existing;
		const entity = simulationWorld.entity();
		simulationWorld.set(entity, PlayerRef, key);
		entities.set(key, entity);
		return entity;
	}
	function remove(key: K) {
		pending.delete(key);
		const entity = entities.get(key);
		if (entity === undefined) return;
		simulationWorld.delete(entity);
		entities.delete(key);
	}
	function queueReady(key: K) {
		const entity = entities.get(key);
		if (entity !== undefined && !simulationWorld.has(entity, ClientReady)) pending.add(key);
	}
	function step(onReady: (key: K) => void) {
		for (const key of pending) {
			pending.delete(key);
			const entity = entities.get(key);
			if (entity === undefined || simulationWorld.has(entity, ClientReady)) continue;
			simulationWorld.add(entity, ClientReady);
			onReady(key);
		}
	}
	function clear() {
		for (const [key] of entities) remove(key);
		pending.clear();
	}
	return {
		simulationWorld,
		PlayerRef,
		ClientReady,
		add,
		remove,
		queueReady,
		step,
		clear,
		getEntity: (key: K) => entities.get(key),
		pendingCount: () => pending.size(),
	};
}
