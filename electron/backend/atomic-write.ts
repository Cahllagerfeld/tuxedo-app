import { Effect, Scope } from "effect";
import { FileSystem } from "effect/FileSystem";
import { dirname, join } from "node:path";
import { Identity } from "./identity";

export const atomicWrite = (path: string, contents: string, mode = 0o600) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const identity = yield* Identity;
		const scope = yield* Effect.scope;
		const directory = dirname(path);
		yield* fs.makeDirectory(directory, { recursive: true });
		const temporary = join(directory, `.tuxedo-${identity.uuid()}.tmp`);
		let committed = false;
		// The nested scope closes the handle before rename; outer cleanup owns only our file.
		yield* Effect.scoped(
			Effect.gen(function* () {
				const handle = yield* fs.open(temporary, { flag: "wx", mode: 0o600 });
				yield* Scope.addFinalizer(
					scope,
					Effect.suspend(() =>
						committed ? Effect.void : Effect.orDie(fs.remove(temporary, { force: true }))
					)
				);
				yield* handle.writeAll(new TextEncoder().encode(contents));
				yield* fs.chmod(temporary, mode);
				yield* handle.sync;
			})
		);
		yield* fs.rename(temporary, path);
		committed = true;
	}).pipe(Effect.scoped, Effect.uninterruptible);
