<script lang="ts">
	import { resolve } from "$app/paths";
	import { Button } from "$lib/shared/ui/button";
	import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
	import type { Workspace } from "../domain/workspace";
	import { workspaceColorClasses } from "./workspace-colors";

	let {
		workspaces,
		activeWorkspaceId,
		disabled,
	}: {
		workspaces: readonly Workspace[];
		activeWorkspaceId: string | null;
		disabled: boolean;
	} = $props();
</script>

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
				class={`size-3 shrink-0 rounded-full ${workspaceColorClasses[workspace.color]}`}
				aria-hidden="true"
			></span>
			<span class="flex min-w-0 flex-1 flex-col gap-1.5">
				<span class="truncate text-base font-semibold">{workspace.name}</span>
				<span
					class="truncate font-mono text-xs font-normal text-muted-foreground"
					title={workspace.todo_path}>{workspace.todo_path}</span
				>
			</span>
			{#if workspace.id === activeWorkspaceId}
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
