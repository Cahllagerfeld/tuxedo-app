import { beforeNavigate, goto, onNavigate } from "$app/navigation";
import { navigating, page } from "$app/state";
import { resolve } from "$app/paths";
import { onMount } from "svelte";
import { on } from "svelte/events";
import { toast } from "svelte-sonner";
import type { AppState } from "./app-state.svelte";
import type { WorkspaceSessionActionResult } from "$lib/modules/workspace/state/workspace-session-types";
import type { DesktopRequest } from "$lib/shared/desktop/contract";

export function createWorkspaceNavigation(app: AppState) {
	const workspace = app.workspace;
	let error = $state("");
	let activating = $state(true);
	const busy = () => activating || workspace.isLoading || workspace.isOperating || !!navigating.to;

	async function activate(id: string | undefined) {
		error = "";
		if (id && (workspace.activeWorkspace?.id !== id || !workspace.todoFile)) {
			const result = await workspace.open(id, false);
			if (result.status !== "applied") error = result.message;
			return result.status === "applied";
		}
		return false;
	}

	async function refreshActivation() {
		try {
			const result = await workspace.reload(true);
			if (result.status !== "applied") error = result.message;
		} finally {
			activating = false;
		}
	}

	beforeNavigate((event) => {
		if (busy()) event.cancel();
		else {
			app.isTodoCreationOpen = false;
			app.bulkSelection.exit();
		}
	});
	onNavigate(async ({ to }) => {
		activating = true;
		const changed = await activate(to?.params?.id);
		// Kit has already loaded the destination: refresh its data only after commit.
		return () => {
			if (changed) void refreshActivation();
			else activating = false;
		};
	});
	onMount(() => {
		const stop = workspace.observe(window.desktop, () => toast.info("Todo file reloaded"));
		// Kit skips beforeNavigate during an awaited onNavigate; stop native traversal too.
		const unblock = on(
			window.navigation,
			"navigate",
			(event: Event & { navigationType?: string }) => {
				if (event.navigationType === "traverse" && busy()) event.preventDefault();
			}
		);
		void (async () => {
			if (page.params.id) {
				const changed = await activate(page.params.id);
				if (changed) await refreshActivation();
				else activating = false;
			} else {
				// Resume once, outside load; subsequent Home visits never restore or redirect.
				await workspace.restore();
				activating = false;
				if (workspace.todoFile && workspace.activeWorkspace)
					await goto(resolve("/workspaces/[id]", { id: workspace.activeWorkspace.id }), {
						replaceState: true,
					});
			}
		})();
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
			return (
				error ||
				workspace.refreshError ||
				(page.data.destination?.status === "rejected" ? page.data.destination.message : "")
			);
		},
		get readerAvailable() {
			return (
				!!page.params.id &&
				!activating &&
				!navigating.to &&
				!error &&
				!workspace.refreshError &&
				page.data.destination?.status === "loaded" &&
				page.data.destination.workspace.id === page.params.id &&
				!!workspace.todoFile &&
				workspace.activeWorkspace?.id === page.params.id
			);
		},
		async retry() {
			if (busy()) return;
			activating = true;
			await workspace.restore();
			const changed = await activate(page.params.id);
			if (changed) await refreshActivation();
			else activating = false;
		},
		async createWorkspace(
			input: DesktopRequest<"createWorkspace">
		): Promise<WorkspaceSessionActionResult> {
			if (busy())
				return { status: "rejected", message: "A Workspace session operation is already running." };
			const result = await workspace.create(input);
			if (result.status === "applied" && result.workspaceId)
				await goto(resolve("/workspaces/[id]", { id: result.workspaceId }));
			return result;
		},
	};
}
