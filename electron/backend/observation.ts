import { watch } from "node:fs";
import { basename, dirname } from "node:path";
import { Effect, type Scope } from "effect";

export type TodoFileObservationAdapter = {
	observe: (path: string, changed: () => void) => Effect.Effect<void, unknown, Scope.Scope>;
};

// Observe the directory entry, so atomic replacement does not strand observation
// on the old inode. The session owns the quiet interval for missing-file save flickers.
export function createTodoFileObservation(): TodoFileObservationAdapter {
	return {
		observe: (path, changed) =>
			Effect.gen(function* () {
				const watcher = yield* Effect.acquireRelease(
					Effect.try(() =>
						watch(dirname(path), (_event, filename) => {
							// macOS reports the observed directory's own name when it moves.
							if (
								filename === null ||
								filename.toString() === basename(path) ||
								filename.toString() === basename(dirname(path))
							)
								changed();
						})
					),
					(watcher) => Effect.sync(() => watcher.close())
				);
				const failed = () => {
					watcher.close();
					changed();
				};
				yield* Effect.acquireRelease(
					Effect.sync(() => watcher.on("error", failed)),
					() =>
						Effect.sync(() => {
							watcher.removeListener("error", failed);
						})
				);
			}),
	};
}
