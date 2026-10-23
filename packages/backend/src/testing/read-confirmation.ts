import { Effect } from "effect";
import type { ConfirmedSession } from "@tuxedo/contracts";
import type { SessionEffects } from "../session";

// No activation or acceptance: this assertion helper only composes public resource reads.
export const readConfirmation = (session: SessionEffects) =>
	Effect.gen(function* () {
		const read = yield* session.readWorkspaceCatalogue({});
		if (read.status !== "ready" || !read.selection) throw Error("Expected a confirmed selection");
		const { scope, revision, undoLabel, workspaceId } = read.selection;
		if (!workspaceId)
			return {
				scope,
				revision,
				...(undoLabel ? { undoLabel } : {}),
				session: { status: "empty", catalogue: read.catalogue, warning: null },
			} satisfies ConfirmedSession;
		const file = yield* session.readWorkspace({ workspaceId });
		if (file.status !== "ready" || file.provenance.status !== "confirmed")
			throw Error("Expected confirmed Workspace contents");
		return {
			scope,
			revision,
			...(undoLabel ? { undoLabel } : {}),
			session: { status: "ready", catalogue: read.catalogue, todo_file: file.todo_file },
		} satisfies ConfirmedSession;
	});
