import { Context, Effect, Layer, Ref } from "effect";
import type { Catalogue } from "../../../src/lib/shared/desktop/contract";
import type { OperationError } from "../operation";
import { WorkspaceCatalogue } from "../workspace-catalogue";

type CatalogueTestState = {
	catalogue: Catalogue;
	readFailure?: OperationError;
	writeFailure?: OperationError;
};

export class WorkspaceCatalogueTestState extends Context.Service<
	WorkspaceCatalogueTestState,
	Ref.Ref<CatalogueTestState>
>()("tuxedo/backend/testing/WorkspaceCatalogueTestState") {}

// Matches Effect's 09_testing/20_layer-tests.ts: expose a Ref alongside the test service.
export const workspaceCatalogueTestLayer = (
	catalogue: Catalogue = { version: 1, workspaces: [], active_workspace_id: null }
) =>
	Layer.effect(
		WorkspaceCatalogue,
		Effect.gen(function* () {
			const state = yield* WorkspaceCatalogueTestState;
			return WorkspaceCatalogue.of({
				read: Ref.get(state).pipe(
					Effect.flatMap(({ catalogue, readFailure }) =>
						readFailure ? Effect.fail(readFailure) : Effect.succeed(catalogue)
					)
				),
				write: (catalogue) =>
					Effect.gen(function* () {
						const { writeFailure } = yield* Ref.get(state);
						if (writeFailure) return yield* Effect.fail(writeFailure);
						yield* Ref.update(state, (current) => ({ ...current, catalogue }));
					}),
			});
		})
	).pipe(
		Layer.provideMerge(
			Layer.effect(WorkspaceCatalogueTestState, Ref.make<CatalogueTestState>({ catalogue }))
		)
	);
