import { expect, layer } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { FileSystem, type File } from "effect/FileSystem";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as PlatformError from "effect/PlatformError";
import { join } from "node:path";
import { atomicWrite } from "./atomic-write";
import { Identity } from "./identity";

const id = "9426bd98-a6dd-48eb-b1ab-037d82983ae1";
const identity = { uuid: () => id, now: () => "2026-05-24T10:00:00.000Z" };

layer(NodeFileSystem.layer, { excludeTestServices: true })("atomic replacement", (it) => {
	it.effect("successful replacement does not require temporary-file cleanup", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.makeTempDirectoryScoped();
			const path = join(directory, "workspaces.json");
			yield* atomicWrite(path, "confirmed").pipe(
				Effect.provideService(FileSystem, {
					...fs,
					remove: () =>
						Effect.fail(
							PlatformError.systemError({
								_tag: "PermissionDenied",
								module: "FileSystem",
								method: "remove",
								description: "cleanup denied",
							})
						),
				})
			);
			expect(yield* fs.readFileString(path)).toBe("confirmed");
			expect(yield* fs.readDirectory(directory)).toEqual(["workspaces.json"]);
		}).pipe(Effect.provideService(Identity, identity))
	);

	it.effect("exclusive acquisition preserves an existing colliding file", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.makeTempDirectoryScoped();
			const path = join(directory, "workspaces.json");
			const temporary = join(directory, `.tuxedo-${id}.tmp`);
			yield* fs.writeFileString(temporary, "Existing private content");
			expect(Exit.isFailure(yield* Effect.exit(atomicWrite(path, "replacement")))).toBe(true);
			expect(yield* fs.readFileString(temporary)).toBe("Existing private content");
			expect(yield* fs.exists(path)).toBe(false);
		}).pipe(Effect.provideService(Identity, identity))
	);

	it.effect("closes its native file handle before rename", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const directory = yield* fs.makeTempDirectoryScoped();
			const path = join(directory, "workspaces.json");
			let opened: File | undefined;
			yield* atomicWrite(path, "confirmed").pipe(
				Effect.provideService(FileSystem, {
					...fs,
					open: (path, options) =>
						fs.open(path, options).pipe(
							Effect.tap((handle) =>
								Effect.sync(() => {
									opened = handle;
								})
							)
						),
					rename: (from, to) =>
						Effect.gen(function* () {
							expect(opened).toBeDefined();
							expect(Exit.isFailure(yield* Effect.exit(opened!.stat))).toBe(true);
							yield* fs.rename(from, to);
						}),
				})
			);
			expect(yield* fs.readFileString(path)).toBe("confirmed");
		}).pipe(Effect.provideService(Identity, identity))
	);
});
