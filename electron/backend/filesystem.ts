import { Context, Data, Effect, Layer } from "effect";
import * as fs from "node:fs/promises";

export class FileSystemFailure extends Data.TaggedError("FileSystemFailure")<{
	operation: string;
	cause: unknown;
}> {
	get message() {
		return this.cause instanceof Error ? this.cause.message : String(this.cause);
	}
}

export const fileIO = <A>(operation: string, run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new FileSystemFailure({ operation, cause }) });

export class FileSystem extends Context.Service<
	FileSystem,
	{
		read: (path: string) => Effect.Effect<string, FileSystemFailure>;
		realpath: (path: string) => Effect.Effect<string, FileSystemFailure>;
		mkdir: (path: string) => Effect.Effect<unknown, FileSystemFailure>;
		open: (
			path: string
		) => Effect.Effect<
			Pick<fs.FileHandle, "writeFile" | "chmod" | "sync" | "close">,
			FileSystemFailure
		>;
		rename: (from: string, to: string) => Effect.Effect<void, FileSystemFailure>;
		remove: (path: string) => Effect.Effect<void, FileSystemFailure>;
	}
>()("tuxedo/backend/FileSystem") {}

export const nodeFileSystem: FileSystem["Service"] = {
	read: (path) =>
		fileIO("read", async () =>
			new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await fs.readFile(path))
		),
	realpath: (path) => fileIO("realpath", () => fs.realpath(path)),
	mkdir: (path) => fileIO("mkdir", () => fs.mkdir(path, { recursive: true })),
	open: (path) => fileIO("open", () => fs.open(path, "wx", 0o600)),
	rename: (from, to) => fileIO("rename", () => fs.rename(from, to)),
	remove: (path) => fileIO("remove", () => fs.rm(path, { force: true })),
};
export const fileSystemLayer = Layer.succeed(FileSystem, nodeFileSystem);
