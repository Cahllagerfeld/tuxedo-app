import type { Catalogue, ConfirmedSession, TodoFile, UndoLabel } from "@tuxedo/contracts";

export type WorkspaceView = {
	readonly catalogue: Catalogue | null;
	readonly activeWorkspace: Catalogue["workspaces"][number] | null;
	readonly todoFile: TodoFile | null;
	readonly undoLabel: UndoLabel | undefined;
	readonly session: ConfirmedSession["session"] | { status: "loading" };
	readonly isLoading: boolean;
};
