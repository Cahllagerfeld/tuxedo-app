<script lang="ts">
	import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
	import { z } from "zod";
	import { defaults, superForm } from "sveltekit-superforms";
	import { zod4, zod4Client } from "sveltekit-superforms/adapters";
	import { Button } from "$lib/shared/ui/button";
	import * as Dialog from "$lib/shared/ui/dialog";
	import * as Form from "$lib/shared/ui/form";
	import { Input } from "$lib/shared/ui/input";
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import { cn } from "@/shared/utils";

	type CreateWorkspaceInput = { name: string; color: Workspace["color"]; todoPath: string };
	type Props = {
		open?: boolean;
		selectFile?: () => Promise<string | null>;
		createWorkspace: (input: CreateWorkspaceInput) => Promise<void>;
		disabled?: boolean;
	};

	const schema = z.object({
		name: z.string().trim().min(1, "Enter a workspace name."),
		color: z.enum(["blue", "green", "amber", "red", "violet", "pink", "cyan", "orange"]),
		todoPath: z.string().min(1, "Choose the exact Todo file for this workspace."),
	});
	const colors: Array<{
		token: Workspace["color"];
		label: string;
		className: string;
		ringClass: string;
	}> = [
		{
			token: "blue",
			label: "Blue",
			className: "bg-blue-600 hover:bg-blue-700 dark:bg-blue-400 dark:hover:bg-blue-300",
			ringClass: "ring-blue-600 dark:ring-blue-400",
		},
		{
			token: "green",
			label: "Green",
			className: "bg-green-600 hover:bg-green-700 dark:bg-green-400 dark:hover:bg-green-300",
			ringClass: "ring-green-600 dark:ring-green-400",
		},
		{
			token: "amber",
			label: "Amber",
			className: "bg-amber-600 hover:bg-amber-700 dark:bg-amber-400 dark:hover:bg-amber-300",
			ringClass: "ring-amber-600 dark:ring-amber-400",
		},
		{
			token: "red",
			label: "Red",
			className: "bg-red-600 hover:bg-red-700 dark:bg-red-400 dark:hover:bg-red-300",
			ringClass: "ring-red-600 dark:ring-red-400",
		},
		{
			token: "violet",
			label: "Violet",
			className: "bg-violet-600 hover:bg-violet-700 dark:bg-violet-400 dark:hover:bg-violet-300",
			ringClass: "ring-violet-600 dark:ring-violet-400",
		},
		{
			token: "pink",
			label: "Pink",
			className: "bg-pink-600 hover:bg-pink-700 dark:bg-pink-400 dark:hover:bg-pink-300",
			ringClass: "ring-pink-600 dark:ring-pink-400",
		},
		{
			token: "cyan",
			label: "Cyan",
			className: "bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-400 dark:hover:bg-cyan-300",
			ringClass: "ring-cyan-600 dark:ring-cyan-400",
		},
		{
			token: "orange",
			label: "Orange",
			className: "bg-orange-600 hover:bg-orange-700 dark:bg-orange-400 dark:hover:bg-orange-300",
			ringClass: "ring-orange-600 dark:ring-orange-400",
		},
	];

	let {
		open = $bindable(false),
		selectFile = selectTodoFile,
		createWorkspace,
		disabled = false,
	}: Props = $props();
	const form = superForm(defaults(zod4(schema)), { validators: zod4Client(schema), SPA: true });
	const { form: formData } = form;
	let serverError = $state("");
	let isCreating = $state(false);
	const canCreate = $derived(
		$formData.name.trim().length > 0 && $formData.todoPath.length > 0 && !isCreating && !disabled
	);

	async function selectTodoFile(): Promise<string | null> {
		const selected = await openFileDialog({
			multiple: false,
			directory: false,
			title: "Choose Todo file",
		});
		return typeof selected === "string" ? selected : null;
	}
	function resetForm() {
		$formData.name = "";
		$formData.todoPath = "";
		$formData.color = "blue";
		serverError = "";
	}
	async function chooseFile() {
		serverError = "";
		try {
			$formData.todoPath = (await selectFile()) ?? "";
		} catch (error) {
			serverError = error instanceof Error ? error.message : String(error);
		}
	}
	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const result = await form.validateForm();
		if (!result.valid) return;
		isCreating = true;
		serverError = "";
		try {
			await createWorkspace(result.data);
			open = false;
			resetForm();
		} catch (error) {
			serverError = error instanceof Error ? error.message : String(error);
		} finally {
			isCreating = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content showCloseButton={false}>
		<Dialog.Header
			><Dialog.Title>Create workspace</Dialog.Title><Dialog.Description
				>Create a saved Workspace for one Todo file.</Dialog.Description
			></Dialog.Header
		>
		<form class="grid gap-6" onsubmit={submit}>
			<Form.Field {form} name="name">
				<Form.Control
					>{#snippet children({ props })}<Form.Label>Workspace name</Form.Label><Input
							{...props}
							bind:value={$formData.name}
							aria-label="Workspace name"
							{disabled}
							autocomplete="off"
						/>{/snippet}</Form.Control
				>
				<Form.FieldErrors />
			</Form.Field>
			<Form.Field {form} name="todoPath">
				<Form.Control
					>{#snippet children({ props })}<Form.Label>Todo file</Form.Label><Button
							{...props}
							type="button"
							variant="outline"
							{disabled}
							onclick={chooseFile}>Choose Todo file</Button
						>{/snippet}</Form.Control
				>
				<Form.Description
					>{$formData.todoPath ||
						"Choose the exact Todo file for this workspace."}</Form.Description
				><Form.FieldErrors />
			</Form.Field>
			<Form.Field {form} name="color">
				<Form.Control
					>{#snippet children({ props })}<Form.Label>Workspace color</Form.Label><Input
							{...props}
							type="hidden"
							bind:value={$formData.color}
						/>{/snippet}</Form.Control
				>
				<div class="flex flex-wrap gap-2">
					{#each colors as option}<Button
							type="button"
							class={cn(
								"aspect-square shrink-0 rounded-full",
								option.className,
								$formData.color === option.token && "ring-2 ring-offset-2 ring-offset-background",
								$formData.color === option.token && option.ringClass
							)}
							aria-label={option.label}
							aria-pressed={$formData.color === option.token}
							{disabled}
							onclick={() => ($formData.color = option.token)}
							><span class="sr-only">{option.label}</span></Button
						>{/each}
				</div>
				<Form.FieldErrors />
			</Form.Field>
			{#if serverError}<p class="text-sm font-medium text-destructive" role="alert">
					{serverError}
				</p>{/if}
			<Dialog.Footer>
				<Dialog.Close
					>{#snippet child({ props })}<Button
							{...props}
							type="button"
							variant="outline"
							disabled={isCreating}
							onclick={() => {
								open = false;
								resetForm();
							}}>Cancel</Button
						>{/snippet}</Dialog.Close
				>
				<Form.Button disabled={!canCreate}
					>{isCreating ? "Creating…" : "Create workspace"}</Form.Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
