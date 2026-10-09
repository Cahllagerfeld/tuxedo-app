<script lang="ts">
	import { tick } from "svelte";
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import CircleDot from "@lucide/svelte/icons/circle-dot";
	import Folder from "@lucide/svelte/icons/folder";
	import Tag from "@lucide/svelte/icons/tag";
	import * as Sidebar from "$lib/shared/ui/sidebar";
	import { cn } from "$lib/shared/utils.js";

	type Props = {
		label: string;
		values: readonly string[];
		selected: string | null;
		prefix?: string;
		disabled?: boolean;
		onSelect: (value: string) => void;
	};

	let { label, values, selected, prefix = "", disabled = false, onSelect }: Props = $props();

	let open = $state(false);
	let search = $state("");
	let highlightedIndex = $state(0);
	let trigger = $state<HTMLButtonElement>();
	let searchInput = $state<HTMLInputElement>();
	const visibleValues = $derived(values.slice(0, 5));
	const selectedOutsideVisible = $derived(
		selected !== null && !visibleValues.includes(selected) ? selected : null
	);
	const filteredValues = $derived(
		values.filter((value) =>
			displayValue(value).toLocaleLowerCase().includes(search.toLocaleLowerCase())
		)
	);

	function displayValue(value: string) {
		return `${prefix}${value}`;
	}

	function choose(value: string) {
		onSelect(value);
		open = false;
		search = "";
		void tick().then(() => trigger?.focus());
	}

	function toggleOpen() {
		open = !open;
		if (open) {
			search = "";
			highlightedIndex = 0;
			void tick().then(() => searchInput?.focus());
		}
	}

	function keydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			open = false;
			void tick().then(() => trigger?.focus());
			return;
		}
		if (filteredValues.length === 0) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			highlightedIndex = (highlightedIndex + 1) % filteredValues.length;
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			highlightedIndex =
				(highlightedIndex - 1 + filteredValues.length) % filteredValues.length;
		} else if (event.key === "Enter") {
			event.preventDefault();
			choose(filteredValues[highlightedIndex]);
		}
	}
</script>

{#if values.length > 0}
	<Sidebar.Group>
		<Sidebar.GroupLabel>{label}</Sidebar.GroupLabel>
		<Sidebar.GroupContent>
			<ul class="space-y-0.5">
				{#each visibleValues as value (value)}
					<li>
						<button
							type="button"
							class={cn(
								"flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
								selected === value && "bg-sidebar-accent font-medium"
							)}
							aria-label={displayValue(value)}
							aria-pressed={selected === value}
							{disabled}
							onclick={() => onSelect(value)}
						>
							{#if label === "Projects"}
								<Folder class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{:else if label === "Priorities"}
								<CircleDot class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{:else}
								<Tag class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{/if}
							<span class="truncate" title={displayValue(value)}>{displayValue(value)}</span>
							{#if selected === value}<Check
									class="ml-auto size-4 shrink-0"
									aria-hidden="true"
								/>{/if}
						</button>
					</li>
				{/each}
				{#if selectedOutsideVisible !== null}
					<li>
						<button
							type="button"
							class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-sidebar-accent px-2 text-left text-sm font-medium"
							aria-label={displayValue(selectedOutsideVisible)}
							aria-pressed="true"
							{disabled}
							onclick={() => onSelect(selectedOutsideVisible)}
						>
							{#if label === "Projects"}
								<Folder class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{:else if label === "Priorities"}
								<CircleDot class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{:else}
								<Tag class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							{/if}
							<span class="truncate" title={displayValue(selectedOutsideVisible)}
								>{displayValue(selectedOutsideVisible)}</span
							>
							<Check class="ml-auto size-4 shrink-0" aria-hidden="true" />
						</button>
					</li>
				{/if}
				{#if values.length > 5}
					<li>
						<button
							bind:this={trigger}
							type="button"
							aria-haspopup="dialog"
							aria-expanded={open}
							class="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
							aria-label={`Show all ${label} values`}
							disabled={disabled}
							onclick={toggleOpen}
						>
							<span>Show all ({values.length})</span>
							<ChevronDown class="size-4" aria-hidden="true" />
						</button>
						{#if open}
							<div
								role="dialog"
								aria-label={`All ${label}`}
								class="z-50 mt-1 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
							>
								<input
									bind:this={searchInput}
									value={search}
									type="search"
									aria-label={`Search ${label}`}
									placeholder={`Search ${label.toLocaleLowerCase()}…`}
									oninput={(event) => {
										search = (event.currentTarget as HTMLInputElement).value;
										highlightedIndex = 0;
									}}
									onkeydown={keydown}
									class="mb-1 h-8 w-full rounded-sm border bg-transparent px-2 text-sm outline-hidden focus:ring-2 focus:ring-ring"
								/>
								<div role="listbox" class="max-h-56 overflow-y-auto">
									{#if filteredValues.length > 0}
										{#each filteredValues as value, index (value)}
											<button
												type="button"
												role="option"
												aria-selected={index === highlightedIndex}
												class={cn(
													"block w-full rounded-sm px-2 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground",
													index === highlightedIndex && "bg-accent text-accent-foreground"
												)}
												onclick={() => choose(value)}
											>
												{displayValue(value)}
											</button>
										{/each}
									{:else}
										<div class="px-2 py-3 text-center text-sm text-muted-foreground">
											No {label.toLocaleLowerCase()} found.
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</li>
				{/if}
			</ul>
		</Sidebar.GroupContent>
	</Sidebar.Group>
{/if}
