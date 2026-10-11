<script lang="ts">
	import { tick } from "svelte";
	import { z } from "zod";
	import {
		createTodoRequestSchema,
		normalizeTodoDescription,
		todoDescriptionSchema,
		todoTagSchema,
		todoDateSchema,
		todoMetadataSchema,
		validateTodoCreation,
	} from "$lib/shared/desktop/contract";
	import { defaults, superForm } from "sveltekit-superforms";
	import { zod4, zod4Client } from "sveltekit-superforms/adapters";
	import type { TodoFile, TodoItem } from "$lib/modules/todo/domain/todo";
	import { Button } from "$lib/shared/ui/button";
	import * as Dialog from "$lib/shared/ui/dialog";
	import * as Form from "$lib/shared/ui/form";
	import { Input } from "$lib/shared/ui/input";
	import { toast } from "svelte-sonner";
	import type { CreateTodoItem } from "./todo-creation-types";
	import TagsInput from "./tags-input/tags-input.svelte";
	import PriorityPicker from "./PriorityPicker.svelte";
	import DatePicker from "./DatePicker.svelte";

	type Props = {
		todoFile: TodoFile;
		createTodoItem: CreateTodoItem;
		workspaceName?: string;
		disabled?: boolean;
		todoToEdit?: TodoItem;
		onClose?: () => void;
	};

	let {
		todoFile,
		createTodoItem,
		workspaceName = "",
		disabled = false,
		todoToEdit,
		onClose,
	}: Props = $props();

	const dateField = z.union([z.literal(""), todoDateSchema]);
	function today() {
		const date = new Date();
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
	}
	const schema = z
		.object({
			description: todoDescriptionSchema.default(""),
			projects: createTodoRequestSchema.shape.projects.default([]),
			contexts: createTodoRequestSchema.shape.contexts.default([]),
			priority: z
				.string()
				.regex(/^(none|[A-Z])$/u, "Choose None, A, B, C, or enter one letter from D to Z.")
				.default("none"),
			creationDate: dateField.default(today()),
			completionDate: dateField.default(""),
			metadata: z.array(todoMetadataSchema).default([]),
		})
		.superRefine((data, ctx) => {
			validateTodoCreation(draft(data), ctx, !!todoToEdit);
		});
	function draft(data: {
		description: string;
		projects: string[];
		contexts: string[];
		priority: string;
		creationDate: string;
		completionDate: string;
		metadata: string[];
	}) {
		return {
			...data,
			description: normalizeTodoDescription(data.description),
			priority: data.priority === "none" ? null : data.priority,
			creationDate: data.creationDate || null,
			completed: todoToEdit?.completed ?? false,
			completionDate: data.completionDate || null,
		};
	}

	const form = superForm(defaults(initialValues(), zod4(schema)), {
		validators: zod4Client(schema),
		SPA: true,
	});
	const { form: formData } = form;

	// The edit dialog is mounted for one selected Todo item.
	// svelte-ignore state_referenced_locally
	let open = $state(!!todoToEdit);
	let isCreating = $state(false);
	let descriptionInput = $state<HTMLInputElement | null>(null);
	let metadataInput = $state<ReturnType<typeof TagsInput>>();
	let triggerButton = $state<HTMLButtonElement | null>(null);
	let tagErrors = $state({ projects: "", contexts: "", metadata: "" });

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

	function setTagError(field: "projects" | "contexts" | "metadata", message: string | undefined) {
		tagErrors[field] = message ?? "";
	}

	function validateTag(
		value: string,
		tags: string[],
		prefix: "+" | "@",
		field: "projects" | "contexts",
		source?: "suggestion"
	) {
		const trimmed = value.trim();
		const clean = !source && trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
		if (!todoTagSchema.safeParse(clean).success) {
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

	function initialValues() {
		if (!todoToEdit) return { creationDate: today() };
		return {
			description: todoToEdit.edit.description,
			projects: [...new Set(todoToEdit.projects)],
			contexts: [...new Set(todoToEdit.contexts)],
			priority: todoToEdit.priority ?? "none",
			creationDate: todoToEdit.creation_date ?? "",
			completionDate: todoToEdit.completion_date ?? "",
			metadata: [...todoToEdit.edit.metadata],
		};
	}

	function resetForm() {
		form.reset({ data: initialValues() });
		tagErrors.metadata = "";
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
			onClose?.();
			void tick().then(() => triggerButton?.focus());
		}
	}

	function cancel() {
		if (controlsDisabled) return;
		resetForm();
		open = false;
		onClose?.();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (controlsDisabled) return;
		if (!metadataInput?.commit()) return;
		isCreating = true;
		try {
			const result = await form.validateForm({ update: true });
			if (!result.valid) return;
			const outcome = await createTodoItem(draft(result.data));
			if (outcome.status === "applied") {
				isCreating = false;
				open = false;
				resetForm();
				await tick();
				triggerButton?.focus();
				onClose?.();
				return;
			}
			if (outcome.status === "conflict") {
				toast.error("Todo file reloaded", { description: outcome.message });
				if (todoToEdit) {
					open = false;
					onClose?.();
				}
			} else {
				toast.error(todoToEdit ? "Could not edit Todo item" : "Could not create Todo item", {
					description: outcome.message,
				});
			}
		} catch (error) {
			toast.error(todoToEdit ? "Could not edit Todo item" : "Could not create Todo item", {
				description: errorMessage(error),
			});
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
	{#if !todoToEdit}
		<Button
			bind:ref={triggerButton}
			variant="outline"
			{disabled}
			aria-label="Add Todo item"
			onclick={() => (open = true)}>+ Add Todo item</Button
		>
	{/if}
	<Dialog.Content
		class="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl"
		closeButtonDisabled={controlsDisabled}
	>
		<Dialog.Header class="shrink-0">
			<Dialog.Title>{todoToEdit ? "Edit Todo item" : "New Todo item"}</Dialog.Title>
			<Dialog.Description>{targetLabel}</Dialog.Description>
		</Dialog.Header>
		<form class="flex min-h-0 flex-col gap-4" onsubmit={submit}>
			<div class="-m-1 grid gap-4 overflow-y-auto p-1">
				<Form.Field {form} name="description">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								>Description <span class="font-normal text-muted-foreground">(optional)</span
								></Form.Label
							>
							<Input
								{...props}
								bind:ref={descriptionInput}
								bind:value={$formData.description}
								placeholder="What needs doing?"
								autocomplete="off"
								disabled={controlsDisabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<div class="grid gap-4 sm:grid-cols-2">
					<Form.Field {form} name="priority">
						<Form.Control
							>{#snippet children({ props })}
								<Form.Label id={`${props.id}-label`}
									>Priority <span class="font-normal text-muted-foreground">(optional)</span
									></Form.Label
								>
								<PriorityPicker
									{...props}
									aria-labelledby={`${props.id}-label`}
									bind:value={$formData.priority}
									disabled={controlsDisabled}
								/>
							{/snippet}</Form.Control
						><Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="creationDate">
						<Form.Control
							>{#snippet children({ props })}
								<Form.Label
									>Creation date <span class="font-normal text-muted-foreground">(optional)</span
									></Form.Label
								>
								<DatePicker
									{...props}
									bind:value={$formData.creationDate}
									disabled={controlsDisabled}
								/>
							{/snippet}</Form.Control
						><Form.FieldErrors />
					</Form.Field>
				</div>

				{#if todoToEdit?.completed}
					<Form.Field {form} name="completionDate">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>Completion date <span class="font-normal text-muted-foreground">(optional)</span
									></Form.Label
								>
								<DatePicker
									{...props}
									bind:value={$formData.completionDate}
									label="Completion date"
									disabled={controlsDisabled}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{/if}
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
								validate={(value, tags, source) =>
									validateTag(value, tags, "+", "projects", source)}
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
								validate={(value, tags, source) =>
									validateTag(value, tags, "@", "contexts", source)}
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

				<Form.Field {form} name="metadata">
					<Form.Control
						>{#snippet children({ props })}
							<Form.Label
								>Metadata <span class="font-normal text-muted-foreground">(optional)</span
								></Form.Label
							>
							<TagsInput
								{...props}
								bind:this={metadataInput}
								bind:value={$formData.metadata}
								placeholder="Add key:value"
								validate={(value) => {
									const clean = value.trim();
									const result = todoMetadataSchema.safeParse(clean);
									if (!result.success) {
										setTagError("metadata", result.error.issues[0].message);
										return undefined;
									}
									setTagError("metadata", undefined);
									return clean;
								}}
								onInvalidChange={(message) => setTagError("metadata", message)}
								disabled={controlsDisabled}
							/>
						{/snippet}</Form.Control
					>
					<Form.Description
						>For example, due:2026-10-12. Press Enter to add more pairs. Repeated keys keep the last
						value.</Form.Description
					>
					{#if tagErrors.metadata}<p role="alert" class="text-sm font-medium text-destructive">
							{tagErrors.metadata}
						</p>{/if}
					<Form.FieldErrors />
				</Form.Field>
			</div>
			<Dialog.Footer class="shrink-0 border-t pt-4">
				<Button type="button" variant="secondary" disabled={controlsDisabled} onclick={cancel}
					>Cancel</Button
				>
				<Form.Button disabled={controlsDisabled}
					>{isCreating
						? todoToEdit
							? "Saving…"
							: "Adding…"
						: todoToEdit
							? "Save changes"
							: "Add Todo item"}</Form.Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
