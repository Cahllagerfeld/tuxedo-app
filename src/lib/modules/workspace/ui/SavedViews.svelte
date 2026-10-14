<script lang="ts">
	import * as Schema from "effect/Schema";
	import { SavedViewNameForm } from "$lib/shared/desktop/contract";
	import { defaults, superForm } from "sveltekit-superforms";
	import { standard, standardClient } from "sveltekit-superforms/adapters";
	import * as Form from "$lib/shared/ui/form";
	import * as Dialog from "$lib/shared/ui/dialog";
	import * as Popover from "$lib/shared/ui/popover";
	import { Button } from "$lib/shared/ui/button";
	import { Input } from "$lib/shared/ui/input";
	import { toast } from "svelte-sonner";
	import type { ElectronWorkspaceSessionState } from "../state/electron-workspace-session.svelte";
	import type { TodoFilterState } from "$lib/modules/todo/state/todo-filter.svelte";

	let {
		workspace,
		todoFilter,
	}: { workspace: ElectronWorkspaceSessionState; todoFilter: TodoFilterState } = $props();
	let menuOpen = $state(false);
	let saveOpen = $state(false);
	let error = $state("");
	const views = $derived(
		workspace.savedViews.filter((view) => view.workspace_id === workspace.activeWorkspace?.id)
	);
	const schema = Schema.toStandardSchemaV1(SavedViewNameForm);
	const initialValues = { name: "" };
	const form = superForm(defaults(initialValues, standard(schema, { defaults: initialValues })), {
		validators: standardClient(schema),
		SPA: true,
	});
	const { form: formData } = form;
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (workspace.isOperating) return;
		$formData.name = $formData.name.trim();
		const validation = await form.validateForm();
		if (!validation.valid) return;
		const outcome = await workspace.saveView($formData.name, todoFilter.snapshot());
		if (outcome.status === "applied") {
			saveOpen = false;
			toast.success("View saved");
		} else error = outcome.message;
	}
	async function deleteView(id: string) {
		const outcome = await workspace.deleteView(id);
		if (outcome.status !== "applied") toast.error(outcome.message);
	}
</script>

<Popover.Root bind:open={menuOpen}>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" disabled={workspace.isOperating}
				>Saved views</Button
			>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-72">
		<div class="grid gap-2">
			<p class="text-sm font-medium">Saved views</p>
			<p class="text-xs text-muted-foreground">For {workspace.activeWorkspace?.name}</p>
			{#if workspace.savedViewsError}<p role="alert" class="text-xs text-destructive">
					{workspace.savedViewsError}
				</p>{/if}
			<div class="max-h-64 overflow-y-auto">
				{#each views as view (view.id)}
					<div class="flex min-w-0 items-center gap-1">
						<Button
							variant="ghost"
							class="min-w-0 flex-1 justify-start"
							disabled={workspace.isOperating}
							onclick={() => {
								todoFilter.applyView(view.filters);
								menuOpen = false;
							}}><span class="truncate">{view.name}</span></Button
						>
						<Button
							variant="ghost"
							size="sm"
							aria-label={`Delete saved view ${view.name}`}
							disabled={workspace.isOperating}
							onclick={() => deleteView(view.id)}>Delete</Button
						>
					</div>
				{:else}<p class="py-2 text-xs text-muted-foreground">No saved views yet.</p>{/each}
			</div>
			<Button
				variant="outline"
				disabled={workspace.isOperating || !!workspace.savedViewsError}
				onclick={() => {
					form.reset();
					error = "";
					menuOpen = false;
					saveOpen = true;
				}}>Save current view</Button
			>
		</div>
	</Popover.Content>
</Popover.Root>
<Dialog.Root bind:open={saveOpen}>
	<Dialog.Content showCloseButton={!workspace.isOperating}>
		<Dialog.Header>
			<Dialog.Title>Save current view</Dialog.Title>
			<Dialog.Description
				>Save the current search, completion status, and filters for this Workspace. Date categories
				stay relative to today.</Dialog.Description
			>
		</Dialog.Header>
		<form class="grid gap-4" onsubmit={save}>
			<Form.Field {form} name="name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>View name</Form.Label>
						<Input
							{...props}
							bind:value={$formData.name}
							disabled={workspace.isOperating}
							autocomplete="off"
						/>
					{/snippet}
				</Form.Control>
				<Form.Description>Choose a unique name within this Workspace.</Form.Description>
				<Form.FieldErrors />
			</Form.Field>
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					disabled={workspace.isOperating}
					onclick={() => (saveOpen = false)}>Cancel</Button
				>
				<Button type="submit" disabled={workspace.isOperating}>Save view</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
