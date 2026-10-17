import { beforeNavigate, goto, onNavigate } from "$app/navigation";
import { navigating, page } from "$app/state";
import { onMount } from "svelte";
import { on } from "svelte/events";
import { toast } from "svelte-sonner";
import type { AppState } from "./app-state.svelte";
import type { WorkspaceSessionActionResult } from "$lib/modules/workspace/state/workspace-session-types";
import type { DesktopRequest } from "$lib/shared/desktop/contract";

export const workspacePath = (id: string) => `/workspaces/${encodeURIComponent(id)}`;

export function createWorkspaceNavigation(app: AppState) {
	const workspace = app.workspace;
	let error = $state("");
	const busy = () => workspace.isLoading || workspace.isOperating || !!navigating.to;

	async function confirm(id: string | undefined, force = false) {
		if (id && (force || workspace.activeWorkspace?.id !== id || !workspace.todoFile)) {
			const result = await workspace.open(id);
			error = result.status === "applied" ? "" : result.message;
		} else error = "";
	}

	beforeNavigate((event) => {
		if (busy()) event.cancel();
		else {
			app.isTodoCreationOpen = false;
			app.bulkSelection.exit();
		}
	});
	onNavigate(({ to }) => confirm(to?.params?.id));
	onMount(() => {
		const stop = workspace.observe(window.desktop, () => toast.info("Todo file reloaded"));
		// SvelteKit skips beforeNavigate during an awaited onNavigate; cancel before popstate.
		const unblock = on(
			window.navigation,
			"navigate",
			(event: Event & { navigationType?: string }) => {
				if (event.navigationType === "traverse" && busy()) event.preventDefault();
			}
		);
		void workspace.initialize().then(async () => {
			if (page.params.id) await confirm(page.params.id);
			else if (page.url.pathname === "/" && workspace.todoFile && workspace.activeWorkspace)
				await goto(workspacePath(workspace.activeWorkspace.id), { replaceState: true });
		});
		return () => {
			stop();
			unblock();
		};
	});

	return {
		get busy() {
			return busy();
		},
		get error() {
			return error;
		},
		get readerAvailable() {
			return (
				!!page.params.id &&
				!navigating.to &&
				!error &&
				!!workspace.todoFile &&
				workspace.activeWorkspace?.id === page.params.id
			);
		},
		async openWorkspace(id: string): Promise<WorkspaceSessionActionResult> {
			if (busy())
				return { status: "rejected", message: "A Workspace session operation is already running." };
			await goto(workspacePath(id));
			return error ? { status: "rejected", message: error } : { status: "applied" };
		},
		async goHome() {
			if (!busy()) await goto("/");
		},
		async retry() {
			if (busy()) return;
			if (!page.params.id || !workspace.catalogue) await workspace.restore();
			await confirm(page.params.id, true);
		},
		async createWorkspace(
			input: DesktopRequest<"createWorkspace">
		): Promise<WorkspaceSessionActionResult> {
			if (busy())
				return { status: "rejected", message: "A Workspace session operation is already running." };
			const result = await workspace.create(input);
			if (result.status === "applied" && workspace.activeWorkspace && workspace.todoFile)
				await goto(workspacePath(workspace.activeWorkspace.id));
			return result;
		},
	};
}
