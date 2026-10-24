<script lang="ts">
	import { tick } from "svelte";
	import {
		todoDateSchema,
		todoTagSchema,
		todoMetadataSchema,
		todoRepeatRuleSchema,
		todoEditorSchema,
		todoEditorDraft,
		type TodoEditorData,
	} from "@tuxedo/contracts/todo-creation";
	import { defaults, superForm } from "sveltekit-superforms";
	import { standard, standardClient } from "sveltekit-superforms/adapters";
	import type { TodoFile, TodoItem } from "$lib/modules/todo/domain/todo";
	import { Button } from "$lib/shared/ui/button";
	import * as Dialog from "$lib/shared/ui/dialog";
	import * as Form from "$lib/shared/ui/form";
	import { Checkbox } from "$lib/shared/ui/checkbox";
	import { Input } from "$lib/shared/ui/input";
	import { toast } from "svelte-sonner";
	import type { SaveTodoItem } from "./todo-editor-types";
	import TagsInput from "./tags-input/tags-input.svelte";
	import PriorityPicker from "./PriorityPicker.svelte";
	import DatePicker from "./DatePicker.svelte";
	import { validDueDate, localToday } from "../domain/todo-due";

	type Props = {
		open?: boolean;
		todoFile: TodoFile;
		saveTodoItem: SaveTodoItem;
		workspaceName?: string;
		disabled?: boolean;
		dismissalBlocked?: boolean;
		showDeferred?: boolean;
		todoToEdit?: TodoItem;
		initialProject?: string | null;
		initialContext?: string | null;
		onClose?: (uncertain?: boolean) => void;
	};

	let {
		todoFile,
		saveTodoItem,
		workspaceName = "",
		disabled = false,
		dismissalBlocked = disabled,
		showDeferred = false,
		todoToEdit,
		initialProject = null,
		initialContext = null,
		open = $bindable(!!todoToEdit),
		onClose,
	}: Props = $props();

	function getDueDate() {
		return (
			validDueDate($formData.metadata.findLast((token) => token.startsWith("due:"))?.slice(4)) ?? ""
		);
	}
	function setDueDate(value: string) {
		const metadata = $formData.metadata.filter((token) => !token.startsWith("due:"));
		if (value) metadata.push(`due:${value}`);
		$formData = { ...$formData, metadata };
	}
	function setShowFrom(value: string) {
		const metadata = $formData.metadata.filter((token) => !token.startsWith("t:"));
		if (value) metadata.push(`t:${value}`);
		$formData = { ...$formData, metadata };
	}
	function repeatFields(metadata: readonly string[]) {
		const value = metadata.findLast((token) => token.startsWith("rec:"))?.slice(4);
		return value && todoRepeatRuleSchema.safeParse(value).success
			? { repeatInterval: value.slice(0, -1), repeatUnit: value.slice(-1) }
			: { repeatInterval: "1", repeatUnit: value === undefined ? "off" : "unsupported" };
	}
	function setMetadata(metadata: string[]) {
		const rules = metadata.filter((token) => token.startsWith("rec:"));
		const previous = $formData.metadata.filter((token) => token.startsWith("rec:"));
		const changed =
			rules.length !== previous.length || rules.some((token, index) => token !== previous[index]);
		$formData = { ...$formData, metadata, ...(changed ? repeatFields(metadata) : {}) };
	}
	function setRepeat(interval: string, unit: string) {
		$formData = { ...$formData, repeatInterval: interval, repeatUnit: unit };
		if (unit !== "off" && !todoRepeatRuleSchema.safeParse(interval + unit).success) return;
		const metadata = $formData.metadata.filter((token) => !token.startsWith("rec:"));
		if (unit !== "off") metadata.push(`rec:${interval}${unit}`);
		$formData = { ...$formData, metadata };
	}
	const repeatUnits = [
		{ value: "off", label: "Off" },
		{ value: "d", label: "Days" },
		{ value: "w", label: "Weeks" },
		{ value: "m", label: "Months" },
		{ value: "y", label: "Years" },
	];

	const schema = todoEditorSchema(() => ({
		editing: !!todoToEdit,
		completed: todoToEdit?.completed ?? false,
	}));
	function draft(data: TodoEditorData) {
		return todoEditorDraft(data, data.completed ?? todoToEdit?.completed ?? false);
	}
	const form = superForm(
		defaults(initialValues(), standard(schema, { defaults: initialValues() })),
		{
			validators: standardClient(schema),
			SPA: true,
		}
	);
	const { form: formData } = form;
	const showFromToken = $derived(
		$formData.metadata.findLast((token) => token.startsWith("t:"))?.slice(2)
	);
	const repeatToken = $derived(
		$formData.metadata.findLast((token) => token.startsWith("rec:"))?.slice(4)
	);
	const showFrom = $derived(
		showFromToken && todoDateSchema.safeParse(showFromToken).success ? showFromToken : ""
	);

	let isSubmitting = $state(false);
	let descriptionInput = $state<HTMLInputElement | null>(null);
	let projectInput = $state<ReturnType<typeof TagsInput>>();
	let contextInput = $state<ReturnType<typeof TagsInput>>();
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
	const controlsDisabled = $derived(disabled || isSubmitting);
	const closeDisabled = $derived(dismissalBlocked || isSubmitting);

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
		if (!todoToEdit)
			return {
				description: "",
				completed: false,
				projects: initialProject === null ? [] : [initialProject],
				contexts: initialContext === null ? [] : [initialContext],
				priority: "none",
				creationDate: localToday(),
				completionDate: "",
				metadata: [],
				...repeatFields([]),
			};
		return {
			description: todoToEdit.edit.description,
			completed: todoToEdit.completed,
			projects: [...new Set(todoToEdit.projects)],
			contexts: [...new Set(todoToEdit.contexts)],
			priority: todoToEdit.priority ?? "none",
			creationDate: todoToEdit.creation_date ?? "",
			completionDate: todoToEdit.completion_date ?? "",
			metadata: [...todoToEdit.edit.metadata],
			...repeatFields(todoToEdit.edit.metadata),
		};
	}

	function resetForm() {
		form.reset({ data: initialValues() });
		tagErrors.metadata = "";
		tagErrors.projects = "";
		tagErrors.contexts = "";
	}

	function handleOpenAutoFocus(event: Event) {
		event.preventDefault();
		resetForm();
		void tick().then(() => descriptionInput?.focus());
	}

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen && closeDisabled) {
			open = true;
			return;
		}
		open = nextOpen;
		if (!nextOpen) {
			resetForm();
			onClose?.();
			void tick().then(() => triggerButton?.focus());
		}
	}

	function cancel() {
		if (closeDisabled) return;
		resetForm();
		open = false;
		onClose?.();
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (controlsDisabled) return;
		if (!projectInput?.commit() || !contextInput?.commit() || !metadataInput?.commit()) return;
		isSubmitting = true;
		try {
			const result = await form.validateForm({ update: true });
			if (!result.valid) return;
			const savedDraft = draft(result.data);
			const outcome = await saveTodoItem(savedDraft);
			if (outcome.status === "applied") {
				if (outcome.notice) toast.info(outcome.notice);
				if (!showDeferred && !savedDraft.completed && showFrom && showFrom > localToday()) {
					toast.success(todoToEdit ? "Todo item saved" : "Todo item created", {
						description: `Hidden until Show from ${showFrom}. Use Show deferred to see it.`,
					});
				}
				isSubmitting = false;
				open = false;
				resetForm();
				await tick();
				triggerButton?.focus();
				onClose?.();
				return;
			}
			if (outcome.status === "conflict") {
				toast.error("Todo file changed", { description: outcome.message });
				if (todoToEdit) {
					open = false;
					onClose?.(true);
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
			isSubmitting = false;
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
		closeButtonDisabled={closeDisabled}
		onOpenAutoFocus={handleOpenAutoFocus}
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

				<Form.Field {form} name="metadata">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								>Due date <span class="font-normal text-muted-foreground">(optional)</span
								></Form.Label
							>
							<DatePicker
								{...props}
								bind:value={getDueDate, setDueDate}
								label="Due date"
								disabled={controlsDisabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.Description
						>Stored as due:YYYY-MM-DD in Metadata. Other due values remain in Metadata until you
						change or clear this date.</Form.Description
					>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="metadata">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								>Show from <span class="font-normal text-muted-foreground">(optional)</span
								></Form.Label
							>
							<DatePicker
								{...props}
								bind:value={() => showFrom, setShowFrom}
								label="Show from"
								disabled={controlsDisabled}
							/>
						{/snippet}
					</Form.Control>
					<Form.Description
						>Stored as t:YYYY-MM-DD in Metadata. Open Todo items stay hidden until this date unless
						Show deferred is on.</Form.Description
					>
					{#if showFromToken && !showFrom}
						<p class="text-sm text-muted-foreground">
							Unsupported Show from value: {showFromToken}. Kept in Metadata until changed or
							cleared.
						</p>
					{/if}
					{#if showFrom && getDueDate() && showFrom > getDueDate()}
						<p role="status" class="text-sm text-muted-foreground">
							Show from is after Due date. This Todo item will stay deferred past its deadline.
						</p>
					{/if}
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="repeatUnit">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label id={`${props.id}-label`}
								>Repeat <span class="font-normal text-muted-foreground">(optional)</span
								></Form.Label
							>
							<div role="group" aria-labelledby={`${props.id}-label`} class="flex flex-wrap gap-1">
								{#each repeatUnits as unit (unit.value)}
									<Button
										type="button"
										size="sm"
										variant={$formData.repeatUnit === unit.value ? "secondary" : "outline"}
										id={unit.value === "off" ? props.id : undefined}
										aria-label={unit.label}
										aria-pressed={$formData.repeatUnit === unit.value}
										disabled={controlsDisabled}
										onclick={() => setRepeat($formData.repeatInterval, unit.value)}
										>{unit.label}</Button
									>
								{/each}
							</div>
						{/snippet}
					</Form.Control>
					<Form.Description
						>Generate the next occurrence relative to its recorded Completion date.</Form.Description
					>
					{#if $formData.repeatUnit === "unsupported"}
						<p class="text-sm text-muted-foreground">
							Unsupported Repeat value: {repeatToken}. Kept in Metadata until changed or turned off.
						</p>
					{/if}
					<Form.FieldErrors />
				</Form.Field>
				{#if $formData.repeatUnit !== "off" && $formData.repeatUnit !== "unsupported"}
					<Form.Field {form} name="repeatInterval">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>Repeat interval</Form.Label>
								<Input
									{...props}
									inputmode="numeric"
									value={$formData.repeatInterval}
									oninput={(event) => setRepeat(event.currentTarget.value, $formData.repeatUnit)}
									disabled={controlsDisabled}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{/if}

				{#if todoToEdit}
					<Form.Field {form} name="completed">
						<Form.Control>
							{#snippet children({ props })}
								<div class="flex items-center gap-2">
									<Checkbox
										{...props}
										checked={$formData.completed}
										disabled={controlsDisabled}
										onCheckedChange={(value) => {
											$formData = {
												...$formData,
												completed: value === true,
												completionDate:
													value === true ? $formData.completionDate || localToday() : "",
											};
										}}
									/>
									<Form.Label>Completed</Form.Label>
								</div>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{/if}
				{#if $formData.completed}
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
								bind:this={projectInput}
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
								bind:this={contextInput}
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
								bind:value={() => $formData.metadata, setMetadata}
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
				<Button type="button" variant="secondary" disabled={closeDisabled} onclick={cancel}
					>Cancel</Button
				>
				<Form.Button disabled={controlsDisabled}
					>{isSubmitting
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
