<script lang="ts">
	import { resolve } from "$app/paths";
	import * as Alert from "$lib/shared/ui/alert";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	import { ScrollArea } from "$lib/shared/ui/scroll-area";
	import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
	import FileText from "@lucide/svelte/icons/file-text";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";
	import Plus from "@lucide/svelte/icons/plus";
	import { workspaceColorClasses } from "./workspace-colors";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";

	type Props = {
		session: ElectronWorkspaceSessionState["session"];
		disabled: boolean;
		openWorkspaceCreationDialog: () => void;
	};

	let { session, disabled, openWorkspaceCreationDialog }: Props = $props();
	let viewport = $state<HTMLElement | null>(null);
	const workspaces = $derived(
		session.status === "empty" || session.status === "ready"
			? [...session.catalogue.workspaces].sort((left, right) =>
					left.created_at.localeCompare(right.created_at)
				)
			: []
	);

	export function focusViewport(): void {
		viewport?.focus();
	}
</script>

<div class="min-h-0 min-w-0 flex-1">
	<ScrollArea
		bind:viewportRef={viewport}
		class="h-full w-full"
		aria-label="Workspaces"
		viewportTabIndex={-1}
	>
		{#if session.status === "loading"}
			<Empty.Root aria-label="Loading workspace session" class="min-h-full rounded-none border-0">
				<Empty.Media variant="icon"
					><LoaderCircle class="animate-spin" aria-hidden="true" /></Empty.Media
				>
				<Empty.Header>
					<Empty.Title>Loading workspaces…</Empty.Title>
					<Empty.Description>Restoring your Workspace session.</Empty.Description>
				</Empty.Header>
			</Empty.Root>
		{:else if session.status === "unavailable"}
			<Empty.Root
				aria-label="Workspace catalogue unavailable"
				class="min-h-full rounded-none border-0"
			>
				<Alert.Root variant="destructive">
					<Alert.Title>Workspaces unavailable</Alert.Title>
					<Alert.Description>{session.error}</Alert.Description>
				</Alert.Root>
			</Empty.Root>
		{:else}
			<section
				aria-label="Workspace home"
				class="mx-auto flex w-full max-w-4xl flex-col px-6 py-12 sm:px-12 sm:py-20"
			>
				<header class="mb-10 flex flex-wrap items-end justify-between gap-6">
					<div>
						<p class="mb-4 text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
							A place for your Todo files
						</p>
						<h1 class="text-4xl font-semibold tracking-tight sm:text-5xl">Your workspaces.</h1>
						<p class="mt-4 max-w-md text-base leading-relaxed text-muted-foreground">
							{workspaces.length
								? "Pick a Workspace and get back to what matters."
								: "A clearer view of what’s next. Start with a Todo file of your own."}
						</p>
					</div>
					{#if workspaces.length}
						<Button {disabled} onclick={openWorkspaceCreationDialog} class="gap-2 px-4"
							><Plus aria-hidden="true" />New workspace</Button
						>
					{/if}
				</header>

				{#if session.status === "empty" && session.warning}
					<Alert.Root class="mb-6">
						<Alert.Title>Could not open your last Workspace</Alert.Title>
						<Alert.Description>{session.warning}</Alert.Description>
					</Alert.Root>
				{/if}

				{#if workspaces.length}
					<div class="mb-3 flex items-center justify-between text-xs text-muted-foreground">
						<h2 class="font-medium">Saved workspaces</h2>
						<span>{workspaces.length} {workspaces.length === 1 ? "Workspace" : "Workspaces"}</span>
					</div>
					<nav aria-label="Saved workspaces" class="flex flex-col gap-3">
						{#each workspaces as workspace (workspace.id)}
							<Button
								variant="outline"
								{disabled}
								href={resolve("/workspaces/[id]", { id: workspace.id })}
								aria-label={workspace.name}
								class="group h-auto w-full justify-start gap-4 rounded-xl p-5 text-left shadow-none sm:gap-5"
							>
								<span
									class="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl"
								>
									<span
										class={`absolute inset-0 opacity-10 ${workspaceColorClasses[workspace.color]}`}
									></span>
									<span
										class={`size-3 rounded-full ${workspaceColorClasses[workspace.color]}`}
										aria-hidden="true"
									></span>
								</span>
								<span class="flex min-w-0 flex-1 flex-col gap-1.5">
									<span class="truncate text-base font-semibold">{workspace.name}</span>
									<span
										class="truncate font-mono text-xs font-normal text-muted-foreground"
										title={workspace.todo_path}>{workspace.todo_path}</span
									>
								</span>
								{#if workspace.id === session.catalogue.active_workspace_id}
									<span
										class="hidden shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-normal text-muted-foreground sm:inline"
										>Last opened</span
									>
								{/if}
								<ArrowUpRight
									class="size-4 text-muted-foreground group-hover:text-foreground"
									aria-hidden="true"
								/>
							</Button>
						{/each}
					</nav>
				{:else}
					<div
						aria-label="No active workspace"
						class="flex flex-col items-center rounded-2xl border border-dashed bg-muted/20 px-6 py-14 text-center sm:py-20"
					>
						<div
							class="mb-6 flex size-16 items-center justify-center rounded-2xl border bg-background shadow-sm"
						>
							<FolderOpen class="size-7 text-muted-foreground" aria-hidden="true" />
						</div>
						<h2 class="text-xl font-semibold tracking-tight">No workspace open</h2>
						<p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
							Connect an existing Todo file. Give it a name and a color, and make it your Workspace.
						</p>
						<Button {disabled} onclick={openWorkspaceCreationDialog} class="mt-7 gap-2 px-4"
							><Plus aria-hidden="true" />New workspace</Button
						>
					</div>
				{/if}
				<footer
					class="mt-8 flex items-start gap-2 border-t pt-5 text-xs leading-relaxed text-muted-foreground"
				>
					<FileText class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
					<p>Plain text, on your device. Your Todo files stay right where you keep them.</p>
				</footer>
			</section>
		{/if}
	</ScrollArea>
</div>
