import { Context, Effect, Layer } from "effect";
import { FileSystem } from "effect/FileSystem";
import { Identity } from "./identity";
import { atomicWrite } from "./atomic-write";
import { attempt, readContents, type OperationError } from "./operation";
import { catalogueSchema, type Catalogue } from "@tuxedo/contracts";

export class WorkspaceCatalogue extends Context.Service<
	WorkspaceCatalogue,
	{
		readonly read: Effect.Effect<Catalogue, OperationError>;
		write: (catalogue: Catalogue) => Effect.Effect<void, OperationError>;
	}
>()("tuxedo/backend/WorkspaceCatalogue") {}

export const workspaceCatalogueLayer = (path: string) =>
	Layer.effect(
		WorkspaceCatalogue,
		Effect.gen(function* () {
			const fs = yield* FileSystem;
			const identity = yield* Identity;
			return WorkspaceCatalogue.of({
				read: readContents(path).pipe(
					Effect.flatMap((contents) => attempt(() => catalogueSchema.parse(JSON.parse(contents)))),
					Effect.provideService(FileSystem, fs)
				),
				write: (catalogue) =>
					atomicWrite(path, JSON.stringify(catalogue, null, 2) + "\n").pipe(
						Effect.provideService(FileSystem, fs),
						Effect.provideService(Identity, identity)
					),
			});
		})
	);
