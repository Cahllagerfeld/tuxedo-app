<script lang="ts">
	import { tick } from "svelte";
	import { z } from "zod";
	import { defaults, superForm } from "sveltekit-superforms";
	import { zod4, zod4Client } from "sveltekit-superforms/adapters";
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import { Button } from "$lib/shared/ui/button";
	import * as Dialog from "$lib/shared/ui/dialog";
	import * as Form from "$lib/shared/ui/form";
	import { Input } from "$lib/shared/ui/input";
	import { toast } from "svelte-sonner";
	import type { CreateTodoItem } from "./todo-creation-types";
	import TagsInput from "./tags-input/tags-input.svelte";

	type Props = {
		todoFile: TodoFile;
		createTodoItem: CreateTodoItem;
		workspaceName?: string;
		disabled?: boolean;
	};

	let { todoFile, createTodoItem, workspaceName = "", disabled = false }: Props = $props();

	const schema = z.object({
		description: z
			.string()
			.refine((value) => value.trim().length > 0, "Enter a Description.")
			.refine(
				(value) => !containsTodoToken(value),
				"Use the Project and Context inputs for tags. Metadata is not supported here."
			),
		projects: z.array(z.string()).default([]),
		contexts: z.array(z.string()).default([]),
	});

	const form = superForm(defaults(zod4(schema)), { validators: zod4Client(schema), SPA: true });
	const { form: formData } = form;

	let open = $state(false);
	let isCreating = $state(false);
	let descriptionInput = $state<HTMLInputElement | null>(null);
	let triggerButton = $state<HTMLButtonElement | null>(null);
	let descriptionError = $state("");
	let tagErrors = $state({ projects: "", contexts: "" });

	const projectSuggestions = $derived(
		uniqueSuggestions(todoFile.items.flatMap((item) => item.projects))
	);
	const contextSuggestions = $derived(
		uniqueSuggestions(todoFile.items.flatMap((item) => item.contexts))
	);
	const todoFileName = $derived(todoFile.path.split(/[\\/]/u).at(-1) ?? todoFile.path);
	const targetLabel = $derived(workspaceName ? `${workspaceName} · ${todoFileName}` : todoFileName);
	const controlsDisabled = $derived(disabled || isCreating);

	function uniqueSuggestions(values: readonly string[]) {
		return [...new Set(values)].sort((left, right) => left.localeCompare(right));
	}

	function containsTodoToken(value: string) {
		return value
			.split(/\s+/)
			.some(
				(token) =>
					/^[+@]\S+$/u.test(token) || /^[^:\p{White_Space}]+:[^:\p{White_Space}]+$/u.test(token)
			);
	}

	function normalizedDescription(value: string) {
		return value.trim().replace(/\s+/g, " ");
	}

	function setTagError(field: "projects" | "contexts", message: string | undefined) {
		tagErrors[field] = message ?? "";
	}

	function validateTag(
		value: string,
		tags: string[],
		prefix: "+" | "@",
		field: "projects" | "contexts"
	) {
		const trimmed = value.trim();
		const clean = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
		if (!clean || /\s/.test(clean) || /^[+@]/.test(clean)) {
			setTagError(field, "Use a tag name without spaces.");
			return undefined;
		}
		if (tags.includes(clean)) {
			setTagError(field, "That tag is already selected.");
			return undefined;
		}
		setTagError(field, undefined);
		return clean;
	}

	function resetForm() {
		form.reset();
		descriptionError = "";
		tagErrors.projects = "";
		tagErrors.contexts = "";
	}

	function focusDescription() {
		void tick().then(() => descriptionInput?.focus());
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && controlsDisabled) {
			open = true;
			return;
		}
		open = nextOpen;
		if (nextOpen) {
			resetForm();
			focusDescription();
		} else {
			resetForm();
			void tick().then(() => triggerButton?.focus());
		}
	}

	function cancel() {
		if (controlsDisabled) return;
		resetForm();
		open = false;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (controlsDisabled) return;
		descriptionError = containsTodoToken($formData.description)
			? "Use the Project and Context inputs for tags. Metadata is not supported here."
			: "";
		if (descriptionError) return;
		isCreating = true;
		try {
			const result = await form.validateForm({ update: true });
			if (!result.valid) return;
			const outcome = await createTodoItem({
				description: normalizedDescription(result.data.description),
				projects: [...result.data.projects],
				contexts: [...result.data.contexts],
			});
			if (outcome.status === "applied") {
				isCreating = false;
				open = false;
				resetForm();
				await tick();
				triggerButton?.focus();
				return;
			}
			if (outcome.status === "conflict") {
				toast.error("Todo file changed externally; reloaded latest version");
			} else {
				toast.error("Could not create Todo item", { description: outcome.message });
			}
		} catch (error) {
			toast.error("Could not create Todo item", { description: errorMessage(error) });
		} finally {
			isCreating = false;
		}
	}

	function errorMessage(error: unknown) {
		if (error instanceof Error) return error.message;
		if (
			typeof error === "object" &&
			error !== null &&
			"message" in error &&
			typeof error.message === "string"
		)
			return error.message;
		return String(error);
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Button
		bind:ref={triggerButton}
		variant="outline"
		{disabled}
		aria-label="Add Todo item"
		onclick={() => (open = true)}>+ Add Todo item</Button
	>
	<Dialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-visible sm:max-w-xl"
		closeButtonDisabled={controlsDisabled}
	>
		<Dialog.Header>
			<Dialog.Title>New Todo item</Dialog.Title>
			<Dialog.Description>{targetLabel}</Dialog.Description>
		</Dialog.Header>
		<form class="grid gap-5" onsubmit={submit}>
			<Form.Field {form} name="description">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Description</Form.Label>
						<Input
							{...props}
							bind:ref={descriptionInput}
							bind:value={$formData.description}
							placeholder="What needs doing?"
							autocomplete="off"
							disabled={controlsDisabled}
							oninput={() => (descriptionError = "")}
						/>
					{/snippet}
				</Form.Control>
				{#if descriptionError}<p role="alert" class="text-sm font-medium text-destructive">
						{descriptionError}
					</p>{/if}
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="projects">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label
							>+Projects <span class="font-normal text-muted-foreground">(optional)</span
							></Form.Label
						>
						<TagsInput
							{...props}
							bind:value={$formData.projects}
							prefix="+"
							suggestions={projectSuggestions}
							placeholder="Choose or create a Project"
							validate={(value, tags) => validateTag(value, tags, "+", "projects")}
							onValueChange={() => setTagError("projects", undefined)}
							onInvalidChange={(message) => setTagError("projects", message)}
							disabled={controlsDisabled}
						/>
					{/snippet}
				</Form.Control>
				<Form.Description>Type a name and press Enter.</Form.Description>
				{#if tagErrors.projects}<p role="alert" class="text-sm font-medium text-destructive">
						{tagErrors.projects}
					</p>{/if}
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="contexts">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label
							>@Contexts <span class="font-normal text-muted-foreground">(optional)</span
							></Form.Label
						>
						<TagsInput
							{...props}
							bind:value={$formData.contexts}
							prefix="@"
							suggestions={contextSuggestions}
							placeholder="Choose or create a Context"
							validate={(value, tags) => validateTag(value, tags, "@", "contexts")}
							onValueChange={() => setTagError("contexts", undefined)}
							onInvalidChange={(message) => setTagError("contexts", message)}
							disabled={controlsDisabled}
						/>
					{/snippet}
				</Form.Control>
				<Form.Description>Reuse a suggestion or create a new name.</Form.Description>
				{#if tagErrors.contexts}<p role="alert" class="text-sm font-medium text-destructive">
						{tagErrors.contexts}
					</p>{/if}
				<Form.FieldErrors />
			</Form.Field>

			<Dialog.Footer class="border-t pt-4">
				<Button type="button" variant="ghost" disabled={controlsDisabled} onclick={cancel}
					>Cancel</Button
				>
				<Form.Button disabled={controlsDisabled}
					>{isCreating ? "Adding…" : "Add Todo item"}</Form.Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
