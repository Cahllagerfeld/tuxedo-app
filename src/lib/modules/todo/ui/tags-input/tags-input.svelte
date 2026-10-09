<script lang="ts">
	import { untrack } from "svelte";
	import { cn } from "$lib/shared/utils.js";
	import type { TagsInputProps } from "./types";
	import TagsInputSuggestion from "./tags-input-suggestion.svelte";
	import TagsInputTag from "./tags-input-tag.svelte";

	const defaultValidate: TagsInputProps["validate"] = (value, tags) => {
		const transformed = value.trim();
		if (transformed.length === 0) return undefined;
		if (tags.includes(transformed)) return undefined;
		return transformed;
	};

	const defaultFilter: NonNullable<TagsInputProps["filterSuggestions"]> = (
		inputValue,
		suggestions
	) => {
		const lower = inputValue.toLowerCase();
		return suggestions.filter((suggestion) => suggestion.toLowerCase().includes(lower));
	};

	let {
		prefix = "",
		value = $bindable([]),
		placeholder,
		class: className,
		disabled = false,
		validate = defaultValidate,
		onValueChange,
		onInvalidChange,
		suggestions,
		filterSuggestions = defaultFilter,
		restrictToSuggestions = false,
		...rest
	}: TagsInputProps = $props();

	let inputValue = $state("");
	let tagIndex = $state<number>();
	let invalid = $state(false);
	let isComposing = $state(false);
	let inputFocused = $state(false);
	let suggestionIndex = $state<number>();
	let listboxId = $props.id();
	let listboxEl = $state<HTMLElement>();

	$effect(() => {
		if (suggestionIndex !== undefined && listboxEl) {
			const item = listboxEl.querySelector(`#${CSS.escape(listboxId)}-${suggestionIndex}`);
			item?.scrollIntoView({ block: "nearest" });
		}
	});

	const filteredSuggestions = $derived.by(() => {
		if (!suggestions) return [];
		const available = suggestions.filter((suggestion) => !value.includes(suggestion));
		return inputValue.length === 0 ? available : filterSuggestions(inputValue, available);
	});
	const showSuggestions = $derived(
		inputFocused && filteredSuggestions.length > 0 && tagIndex === undefined
	);

	$effect(() => {
		filteredSuggestions;
		untrack(() => (suggestionIndex = undefined));
	});

	$effect(() => {
		inputValue;
		untrack(() => {
			invalid = false;
			onInvalidChange?.(undefined);
		});
	});

	function selectSuggestion(suggestion: string) {
		const validated = validate(suggestion, value);
		if (!validated) return;
		value = [...value, validated];
		onValueChange?.(value);
		onInvalidChange?.(undefined);
		inputValue = "";
		suggestionIndex = undefined;
	}

	function enter() {
		if (isComposing) return;
		if (showSuggestions && suggestionIndex !== undefined) {
			selectSuggestion(filteredSuggestions[suggestionIndex]);
			return;
		}
		if (restrictToSuggestions && suggestions) {
			const match = suggestions.find(
				(suggestion) => suggestion.toLowerCase() === inputValue.trim().toLowerCase()
			);
			if (!match) {
				invalid = true;
				return;
			}
			selectSuggestion(match);
			return;
		}
		const validated = validate(inputValue, value);
		if (!validated) {
			invalid = true;
			return;
		}
		value = [...value, validated];
		onValueChange?.(value);
		onInvalidChange?.(undefined);
		inputValue = "";
	}

	function deleteIndex(index: number) {
		value = [...value.slice(0, index), ...value.slice(index + 1)];
		onValueChange?.(value);
	}

	function deleteValue(tag: string) {
		const index = value.findIndex((candidate) => candidate === tag);
		if (index !== -1) deleteIndex(index);
	}

	function keydown(event: KeyboardEvent) {
		const target = event.target as HTMLInputElement;
		if (event.key === "Escape" && showSuggestions) {
			event.preventDefault();
			suggestionIndex = undefined;
			inputFocused = false;
			target.blur();
			return;
		}
		if (showSuggestions && event.key === "ArrowDown") {
			event.preventDefault();
			suggestionIndex =
				suggestionIndex === undefined ? 0 : (suggestionIndex + 1) % filteredSuggestions.length;
			return;
		}
		if (showSuggestions && event.key === "ArrowUp") {
			event.preventDefault();
			suggestionIndex =
				suggestionIndex === undefined
					? filteredSuggestions.length - 1
					: (suggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			if (isComposing) return;
			if (tagIndex !== undefined) {
				deleteIndex(tagIndex);
				tagIndex = tagIndex > 0 ? tagIndex - 1 : undefined;
				return;
			}
			enter();
			return;
		}

		const atBeginning = target.selectionStart === 0 && target.selectionEnd === 0;
		let resetIndex = true;
		if (event.key === "Backspace" && atBeginning) {
			event.preventDefault();
			if (tagIndex !== undefined) {
				deleteIndex(tagIndex);
				tagIndex = tagIndex > 0 ? tagIndex - 1 : undefined;
			} else {
				tagIndex = value.length - 1;
			}
			resetIndex = false;
		}
		if (
			event.key === "Delete" &&
			atBeginning &&
			inputValue.length === 0 &&
			tagIndex !== undefined
		) {
			event.preventDefault();
			deleteIndex(tagIndex);
			if (value.length === 0) tagIndex = undefined;
			resetIndex = false;
		}
		if (atBeginning) {
			if (event.key === "ArrowLeft") {
				tagIndex = tagIndex === undefined ? value.length - 1 : Math.max(0, tagIndex - 1);
				resetIndex = false;
			}
			if (inputValue.length === 0 && event.key === "ArrowRight" && tagIndex !== undefined) {
				tagIndex = tagIndex + 1 > value.length - 1 ? undefined : tagIndex + 1;
				resetIndex = false;
			}
		}
		if (resetIndex) tagIndex = undefined;
	}

	function blur() {
		tagIndex = undefined;
		setTimeout(() => (inputFocused = false), 150);
	}
</script>

<div
	class={cn(
		"relative flex min-h-[36px] w-full flex-wrap place-items-center gap-1 rounded-md border border-input bg-background py-0.5 pr-1 pl-1 selection:bg-primary disabled:opacity-50 aria-disabled:cursor-not-allowed dark:bg-input/30",
		className
	)}
	aria-disabled={disabled}
>
	{#each value as tag, index (tag)}
		<TagsInputTag
			value={tag}
			{prefix}
			{disabled}
			active={index === tagIndex}
			onDelete={deleteValue}
		/>
	{/each}
	<input
		{...rest}
		bind:value={inputValue}
		onblur={blur}
		onfocus={() => (inputFocused = true)}
		oncompositionstart={() => (isComposing = true)}
		oncompositionend={() => (isComposing = false)}
		{disabled}
		{placeholder}
		data-invalid={invalid}
		onkeydown={keydown}
		role={suggestions ? "combobox" : undefined}
		aria-expanded={suggestions ? showSuggestions : undefined}
		aria-autocomplete={suggestions ? "list" : undefined}
		aria-controls={suggestions ? listboxId : undefined}
		aria-activedescendant={suggestionIndex !== undefined
			? `${listboxId}-${suggestionIndex}`
			: undefined}
		class="min-w-16 shrink grow basis-0 border-none bg-transparent px-2 outline-hidden placeholder:text-muted-foreground focus:outline-hidden disabled:cursor-not-allowed data-[invalid=true]:text-red-500 md:text-sm"
	/>
	{#if showSuggestions}
		<div
			bind:this={listboxEl}
			id={listboxId}
			role="listbox"
			class="absolute top-full right-0 left-0 z-50 mt-1 max-h-50 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		>
			{#each filteredSuggestions as suggestion, index (suggestion)}
				<TagsInputSuggestion
					id={`${listboxId}-${index}`}
					value={suggestion}
					active={index === suggestionIndex}
					onSelect={selectSuggestion}
				/>
			{/each}
		</div>
	{/if}
</div>
