<script lang="ts">
	import { resolve } from "$app/paths";
	import { workspaceColorClasses } from "./workspace-colors";
	import { Button } from "$lib/shared/ui/button";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	let {
		workspace,
		loading = false,
		disabled = false,
		unavailable = null,
		openCreationDialog,
		retry,
		showHome = false,
	}: {
		workspace: ElectronWorkspaceSessionState;
		loading?: boolean;
		disabled?: boolean;
		unavailable?: string | null;
		openCreationDialog: () => void;
		retry: () => Promise<void>;
		showHome?: boolean;
	} = $props();
	const workspaces = $derived(
		[...(workspace.catalogue?.workspaces ?? [])].sort((a, b) =>
			a.created_at.localeCompare(b.created_at)
		)
	);
	let viewport: HTMLElement;
	export function focusViewport() {
		viewport?.focus();
	}
</script>

<section
	bind:this={viewport}
	tabindex="-1"
	class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6"
	aria-label="Workspace destination"
	aria-busy={loading}
>
	{#if loading}
		<p role="status">Loading Workspaces…</p>
	{:else if unavailable || workspace.error}
		<h1 class="text-xl font-semibold">Workspace unavailable</h1>
		<p role="alert">{unavailable || workspace.error}</p>
		<div class="flex gap-2">
			<Button {disabled} onclick={retry}>Retry</Button>
			{#if showHome}<Button variant="outline" {disabled} href={resolve("/")}>Home</Button>{/if}
		</div>
	{:else}
		<h1 class="text-xl font-semibold">Workspaces</h1>
		{#if workspace.warning}
			<div class="flex items-center gap-2">
				<p role="status">{workspace.warning}</p>
				<Button {disabled} onclick={retry}>Retry</Button>
			</div>
		{/if}
		{#if workspaces.length === 0}<p class="text-muted-foreground">
				Create a Workspace to open a Todo file.
			</p>{/if}
		<ul class="grid gap-2">
			{#each workspaces as saved (saved.id)}
				<li>
					<Button
						variant="outline"
						class="w-full justify-start gap-3"
						{disabled}
						href={resolve("/workspaces/[id]", { id: saved.id })}
					>
						<span
							class={`size-2.5 shrink-0 rounded-full ${workspaceColorClasses[saved.color]}`}
							aria-hidden="true"
						></span>
						<span class="sr-only">{saved.color}</span>
						{saved.name}
					</Button>
				</li>
			{/each}
		</ul>
		<div><Button {disabled} onclick={openCreationDialog}>New Workspace</Button></div>
	{/if}
</section>
