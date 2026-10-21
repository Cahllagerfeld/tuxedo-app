import type { Effect, Scope } from "effect";

export type TodoFileObservationAdapter = {
	observe: (path: string, changed: () => void) => Effect.Effect<void, unknown, Scope.Scope>;
};
