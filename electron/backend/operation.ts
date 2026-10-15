import { Data, Effect } from "effect";
import { FileSystem } from "effect/FileSystem";
import { badArgument, type PlatformError } from "effect/PlatformError";
import { decodeTodoContents } from "./todo-file";

export class OperationFailure extends Data.TaggedError("OperationFailure")<{ message: string }> {}
export type OperationError = PlatformError | OperationFailure;
export const attempt = <A>(parse: () => A) =>
	Effect.try({
		try: parse,
		catch: (error) =>
			new OperationFailure({ message: error instanceof Error ? error.message : String(error) }),
	});
export const readContents = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem;
		const bytes = yield* fs.readFile(path);
		return yield* Effect.try({
			try: () => decodeTodoContents(bytes),
			catch: (cause) =>
				badArgument({
					module: "FileSystem",
					method: "readFile",
					description: "Invalid UTF-8 file contents",
					cause,
				}),
		});
	});
