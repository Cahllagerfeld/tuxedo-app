import { WorkspaceCommands, type WorkspaceLoadedData } from "./workspace-commands.svelte";
import { readViewsData } from "./workspace-load";
import type { ConfirmedSession, ConfirmedTodo, DesktopAPI } from "$lib/shared/desktop/contract";

// Model backend confirmations for isolated renderer tests.
export class WorkspaceSessionFixture extends WorkspaceCommands {
	initialize: WorkspaceCommands["restore"];
	constructor(desktop: DesktopAPI, onRefreshed: () => void = () => {}) {
		let backend: ConfirmedSession | undefined;
		let data = $state.raw<WorkspaceLoadedData>({ error: "No Workspace data loaded." });
		const adapter = new Proxy(desktop, {
			get(target, key: keyof DesktopAPI) {
				return async (...args: unknown[]) => {
					const outcome = await Reflect.apply(target[key], target, args);
					if (key === "restoreSession") backend = outcome;
					else if (outcome?.confirmed && outcome.status !== "rejected") {
						const incoming: ConfirmedSession | ConfirmedTodo = outcome.confirmed;
						if ("session" in incoming) backend = incoming;
						else if (backend?.session.status === "ready")
							backend = {
								...backend,
								revision: incoming.revision,
								undoLabel: incoming.undoLabel,
								session: { ...backend.session, todo_file: incoming.todo_file },
							};
					}
					return outcome;
				};
			},
		});
		const refresh = async (dependency: "session" | "views" | "lifecycle") => {
			if (dependency !== "views" && backend)
				data = { ...data, confirmed: backend, error: undefined };
			if (dependency !== "session") {
				data = {
					...data,
					savedViews: undefined,
					savedViewsError: undefined,
					...(await readViewsData(desktop)),
				};
			}
			onRefreshed();
		};
		super(adapter, () => data, refresh);
		this.initialize = async () => {
			const outcome = await this.restore();
			if (outcome.status === "applied") await this.reloadViews();
			else data = { error: outcome.message };
			return outcome;
		};
	}
}
