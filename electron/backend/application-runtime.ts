import { Effect, Exit, Scope, type ManagedRuntime } from "effect";

const shutdownDeadlineMs = 10_000;

export function createApplicationRuntime<R>(
	runtime: ManagedRuntime.ManagedRuntime<R, never>,
	beforeRelease: Effect.Effect<void, never, R> = Effect.void,
	stopAdmission: () => void = () => {}
) {
	// The Promise bridge needs an immediate scope; dispose always closes it after draining.
	const scope = Scope.makeUnsafe();
	const pending = new Map<Promise<unknown>, string>();
	let closing = false;
	let disposal: Promise<void> | undefined;
	let shutdown: Promise<"complete" | "timeout" | "failed"> | undefined;
	let phase = "drain";
	const run = <A, E>(name: string, effect: Effect.Effect<A, E, R | Scope.Scope>): Promise<A> => {
		if (closing) return Promise.reject(Error("Application is shutting down"));
		const result = runtime.runPromise(effect.pipe(Scope.provide(scope), Effect.uninterruptible));
		pending.set(result, name);
		void result.then(
			() => pending.delete(result),
			() => pending.delete(result)
		);
		return result;
	};
	const dispose = () => {
		closing = true;
		stopAdmission();
		return (disposal ??= (async () => {
			await Promise.allSettled([...pending.keys()]);
			try {
				phase = "observers";
				await runtime.runPromise(beforeRelease);
			} finally {
				try {
					phase = "platform resources";
					await runtime.runPromise(Scope.close(scope, Exit.void));
				} finally {
					phase = "runtime disposal";
					await runtime.dispose();
				}
			}
		})());
	};
	return {
		run,
		dispose,
		shutdown(deadlineMs = shutdownDeadlineMs) {
			if (shutdown) return shutdown;
			const draining = dispose();
			shutdown = new Promise((resolve) => {
				const timer = setTimeout(() => {
					console.error("Application shutdown deadline exceeded", {
						deadlineMs,
						phase,
						pending: [...pending.values()],
					});
					resolve("timeout");
				}, deadlineMs);
				void draining.then(
					() => {
						clearTimeout(timer);
						resolve("complete");
					},
					(error) => {
						clearTimeout(timer);
						console.error("Application shutdown failed", { phase, error });
						resolve("failed");
					}
				);
			});
			return shutdown;
		},
	};
}
