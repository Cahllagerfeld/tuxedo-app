import { Effect } from "effect";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { FileSystem, fileIO } from "./filesystem";

export const atomicWrite = (path: string, contents: string, mode = 0o600) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const directory = dirname(path);
		yield* fs.mkdir(directory);
		const temporary = join(directory, `.tuxedo-${randomUUID()}.tmp`);
		let closed = false;
		// Own cleanup only after exclusive creation; never remove a colliding file.
		const handle = yield* Effect.acquireRelease(fs.open(temporary), (handle) =>
			(closed ? Effect.void : Effect.orDie(fileIO("close", () => handle.close()))).pipe(
				Effect.ensuring(Effect.orDie(fs.remove(temporary)))
			)
		);
		yield* fileIO("write", () => handle.writeFile(contents, "utf8"));
		yield* fileIO("chmod", () => handle.chmod(mode));
		yield* fileIO("sync", () => handle.sync());
		yield* fileIO("close", () => handle.close());
		closed = true;
		yield* fs.rename(temporary, path);
	}).pipe(Effect.scoped, Effect.uninterruptible);
