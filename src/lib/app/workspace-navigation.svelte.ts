import { afterNavigate, beforeNavigate, goto, replaceState } from "$app/navigation";
import { page } from "$app/state";
import { resolve } from "$app/paths";
import { onMount } from "svelte";
import { on } from "svelte/events";
import { toast } from "svelte-sonner";
import { invalidate } from "$app/navigation";
import type { WorkspaceCommands } from "$lib/modules/workspace/state/workspace-commands.svelte";
import type { DesktopRequest } from "$lib/shared/desktop/contract";
import { clearEntryFailure } from "./workspace-entry";
import { unavailableWorkspaceUrl } from "./workspace-home";

export function createWorkspaceNavigation(commands: WorkspaceCommands) {
	const workspace = commands.data;
	let failure = $state("");
	let admittedHref: string | undefined;
	const busy = () => commands.isOperating;
	async function recover(force = false) {
		if (!page.params.id || (!force && workspace.todoFile && !workspace.error)) return;
		const recovery = new URL(unavailableWorkspaceUrl(page.params.id), page.url);
		admittedHref = recovery.href;
		await goto(recovery, { replaceState: true });
	}

	async function commit(id: string, url: URL, delta?: number) {
		clearEntryFailure();
		// Drop a speculative destination snapshot after activation, before Kit loads the actual entry.
		await invalidate(`workspace:destination:${id}`);
		admittedHref = url.href;
		if (delta !== undefined) {
			// Preserve the browser's existing entry, state, scroll and traversal direction.
			await new Promise<void>((done) => {
				finishTraversal = done;
				history.go(delta);
			});
		} else {
			await goto(url);
		}
	}
	let finishTraversal: (() => void) | undefined;

	async function visit(id: string, url: URL, delta?: number, beforeActivation?: Promise<void>) {
		failure = "";
		const outcome = await commands.open(
			id,
			async (outcome) => {
				if (outcome.status !== "applied") failure = outcome.message;
				await commit(id, url, delta);
			},
			beforeActivation
		);
		if (outcome.status === "applied" && outcome.notice) toast.info(outcome.notice);
		else if (outcome.status === "rejected")
			toast.error("Could not open Workspace", { description: outcome.message });
	}

	beforeNavigate((event) => {
		if (event.type === "leave") return;
		if (event.to?.url.href === admittedHref) {
			admittedHref = undefined;
			const finish = () => {
				finishTraversal?.();
				finishTraversal = undefined;
			};
			void event.complete.then(finish, finish);
			return;
		}
		if (busy()) {
			event.cancel();
			return;
		}
		clearEntryFailure();
		const id = event.to?.params?.id;
		if (id && (id !== workspace.activeWorkspace?.id || !workspace.todoFile)) {
			// Kit restores a canceled traversal before we can safely repeat its original delta.
			const restored =
				event.type === "popstate"
					? new Promise<void>((done) => {
							const original = page.url.href;
							const listener = () => {
								if (location.href !== original) return;
								window.removeEventListener("popstate", listener);
								done();
							};
							window.addEventListener("popstate", listener);
						})
					: undefined;
			event.cancel();
			void visit(id, event.to!.url, event.type === "popstate" ? event.delta : undefined, restored);
		} else failure = "";
	});
	afterNavigate((event) => {
		// Kit retains the traversed address when a history load redirects to Home.
		if (event.to?.route.id === "/workspaces" && location.href !== event.to.url.href)
			replaceState(event.to.url, page.state);
		void event.complete.then(() => commands.resumeObservation());
	});

	onMount(() => {
		const stop = commands.observe(window.desktop, () => toast.info("Todo file reloaded"));
		// Chromium can traverse history while Kit is awaiting a load and skips beforeNavigate then.
		const unblock = on(
			window.navigation,
			"navigate",
			(
				event: Event & {
					navigationType?: string;
					destination?: { url: string };
				}
			) => {
				if (
					event.navigationType === "traverse" &&
					busy() &&
					event.destination?.url !== admittedHref &&
					event.destination?.url !== page.url.href
				)
					event.preventDefault();
			}
		);
		return () => {
			stop();
			unblock();
		};
	});

	return {
		recover,
		selectWorkspace(id: string) {
			if (busy()) return;
			const url = new URL(resolve("/workspaces/[id]", { id }), page.url);
			if (workspace.activeWorkspace?.id === id && workspace.todoFile) void goto(url);
			else void visit(id, url);
		},
		get busy() {
			return busy();
		},
		get error() {
			return failure || workspace.error || commands.refreshError;
		},
		async retry() {
			if (busy()) return;
			clearEntryFailure();
			failure = "";
			const requestedId = page.url.searchParams.get("unavailable");
			const outcome = await commands.restore();
			if (outcome.status !== "applied") return;
			const id = requestedId || workspace.activeWorkspace?.id;
			if (!id) return;
			const url = new URL(resolve("/workspaces/[id]", { id }), page.url);
			if (workspace.activeWorkspace?.id === id && workspace.todoFile)
				await goto(url, { invalidate: [`workspace:destination:${id}`] });
			else await visit(id, url);
		},
		createWorkspace(input: DesktopRequest<"createWorkspace">) {
			return commands.create(input, (id) =>
				commit(id, new URL(resolve("/workspaces/[id]", { id }), page.url))
			);
		},
	};
}
