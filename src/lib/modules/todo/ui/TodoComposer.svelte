<script lang="ts">
	import { defaults, superForm } from "sveltekit-superforms";
	import { zod4, zod4Client } from "sveltekit-superforms/adapters";
	import { summarizeTodoFile } from "$lib/modules/todo/domain/todo-file-summary";
	import {
		normalizeTag,
		todoComposerDefaults,
		todoComposerSchema,
	} from "$lib/modules/todo/domain/todo-composer";
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import type { TodoState } from "$lib/modules/todo/state/todo-state.svelte";
	import * as Collapsible from "$lib/shared/ui/collapsible";
	import * as Form from "$lib/shared/ui/form";
	import { Input } from "$lib/shared/ui/input";
	import { TagsInput } from "$lib/shared/ui/tags-input";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";

	type Props = {
		todoFile: TodoFile;
		todoState: TodoState;
		disabled?: boolean;
		onCreateError: (error: unknown) => void;
	};

	let { todoFile, todoState, disabled = false, onCreateError }: Props = $props();

	const form = superForm(defaults(todoComposerDefaults, zod4(todoComposerSchema)), {
		validators: zod4Client(todoComposerSchema),
		SPA: true,
	});
	const { form: formData, errors, validateForm } = form;

	let detailsOpen = $state(false);
	let descriptionInput = $state<HTMLInputElement | null>(null);

	const summary = $derived(summarizeTodoFile(todoFile));
	const projectSuggestions = $derived(summary.facets.projects.map((project) => `+${project}`));
	const contextSuggestions = $derived(summary.facets.contexts.map((context) => `@${context}`));
	const isBusy = $derived(disabled || todoState.isMutationPending);

	function tagValidator(prefix: "+" | "@") {
		return (raw: string, tags: string[]): string | undefined => {
			const normalized = normalizeTag(raw, prefix);
			if (!normalized) return undefined;
			const withPrefix = `${prefix}${normalized}`;
			if (tags.includes(withPrefix)) return undefined;
			return withPrefix;
		};
	}

	function resetComposer() {
		$formData.description = "";
		$formData.projects = [];
		$formData.contexts = [];
		$errors = {};
		detailsOpen = false;
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const draft = {
			description: $formData.description,
			projects: [...$formData.projects],
			contexts: [...$formData.contexts],
		};
		const result = await validateForm({ update: true });
		if (!result.valid) {
			$formData.description = draft.description;
			$formData.projects = draft.projects;
			$formData.contexts = draft.contexts;
			return;
		}

		try {
			await todoState.create({
				description: result.data.description,
				projects: result.data.projects,
				contexts: result.data.contexts,
			});
			resetComposer();
			descriptionInput?.focus();
		} catch (error) {
			$formData.description = draft.description;
			$formData.projects = draft.projects;
			$formData.contexts = draft.contexts;
			onCreateError(error);
		}
	}
</script>

<form class="mb-4 grid w-full gap-3" aria-label="Todo composer" onsubmit={submit}>
	<div class="flex items-start gap-2">
		<Form.Field {form} name="description" class="min-w-0 flex-1">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="sr-only">Description</Form.Label>
					<Input
						{...props}
						bind:ref={descriptionInput}
						bind:value={$formData.description}
						aria-label="Description"
						placeholder="Description"
						disabled={isBusy}
						autocomplete="off"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
		<Form.Button disabled={isBusy}>Add Todo item</Form.Button>
	</div>

	<Collapsible.Root bind:open={detailsOpen}>
		<Collapsible.Trigger
			type="button"
			class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
			disabled={isBusy}
		>
			Add details
			<ChevronDown
				class={detailsOpen
					? "size-4 rotate-180 transition-transform"
					: "size-4 transition-transform"}
			/>
		</Collapsible.Trigger>
		<Collapsible.Content class="mt-3 grid gap-3">
			<Form.Field {form} name="projects">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>+Project</Form.Label>
						<TagsInput
							{...props}
							bind:value={$formData.projects}
							aria-label="Projects"
							placeholder="Add Project"
							disabled={isBusy}
							suggestions={[...projectSuggestions]}
							validate={tagValidator("+")}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="contexts">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>@context</Form.Label>
						<TagsInput
							{...props}
							bind:value={$formData.contexts}
							aria-label="Contexts"
							placeholder="Add Context"
							disabled={isBusy}
							suggestions={[...contextSuggestions]}
							validate={tagValidator("@")}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</Collapsible.Content>
	</Collapsible.Root>
</form>
