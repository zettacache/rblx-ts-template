export interface SimulationSystem {
	readonly name: string;
	readonly run: (deltaTime: number) => void;
}
export interface SystemTiming {
	calls: number;
	lastSeconds: number;
	totalSeconds: number;
	maxSeconds: number;
}

/** Explicit ordering; the caller chooses the update phase and profiling mode. */
export function createSystemRunner(systems: readonly SimulationSystem[], profiling = false) {
	const timings = new Map<string, SystemTiming>();
	const names = new Set<string>();
	for (const system of systems) {
		assert(!names.has(system.name), `Duplicate system name: ${system.name}`);
		names.add(system.name);
	}
	function step(deltaTime: number) {
		for (const system of systems) {
			const started = profiling ? os.clock() : 0;
			if (profiling) debug.profilebegin(system.name);
			const [ok, failure] = xpcall(
				() => system.run(deltaTime),
				(message) => debug.traceback(tostring(message)),
			);
			if (profiling) {
				debug.profileend();
				const elapsed = os.clock() - started;
				const timing = timings.get(system.name) ?? {
					calls: 0,
					lastSeconds: 0,
					totalSeconds: 0,
					maxSeconds: 0,
				};
				timing.calls += 1;
				timing.lastSeconds = elapsed;
				timing.totalSeconds += elapsed;
				timing.maxSeconds = math.max(timing.maxSeconds, elapsed);
				timings.set(system.name, timing);
			}
			if (!ok) error(`System "${system.name}" failed:\n${tostring(failure)}`, 0);
		}
	}
	return { step, getTimings: () => timings as ReadonlyMap<string, Readonly<SystemTiming>> };
}
