import {
	ElectronWorkspaceSessionState,
	type WorkspaceLoadedData,
} from "./electron-workspace-session.svelte";
import { readViewsData } from "./workspace-load";
import type { ConfirmedSession, ConfirmedTodo, DesktopAPI } from "$lib/shared/desktop/contract";

// Legacy UI adapters return writes rather than subsequent reads; model their backend here.
export class WorkspaceSessionFixture extends ElectronWorkspaceSessionState {
	private initializeFixture: () => Promise<
		{ status: "applied" } | { status: "rejected"; message: string }
	>;
	constructor(desktop: DesktopAPI) {
		let backend: ConfirmedSession | undefined;
		let data = $state.raw<WorkspaceLoadedData>({});
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
			if (dependency !== "views") data = { ...data, confirmed: backend, error: undefined };
			if (dependency !== "session") {
				data = {
					...data,
					savedViews: undefined,
					savedViewsError: undefined,
					...(await readViewsData(desktop)),
				};
			}
		};
		super(adapter, () => data, refresh);
		let initialization: ReturnType<typeof this.initializeFixture> | undefined;
		this.initializeFixture = () =>
			(initialization ??= (async () => {
				try {
					backend = await adapter.restoreSession({});
					await refresh("session");
					await refresh("views");
					return { status: "applied" as const };
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					data = { error: message };
					return { status: "rejected" as const, message };
				}
			})());
	}
	initialize = () => this.initializeFixture();
}

export type { CreateTodoDraft } from "./electron-workspace-session.svelte";
