<script lang="ts">
	import { tick } from "svelte";
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import CircleDot from "@lucide/svelte/icons/circle-dot";
	import Folder from "@lucide/svelte/icons/folder";
	import Tag from "@lucide/svelte/icons/tag";
	import * as Button from "$lib/shared/ui/button";
	import * as Command from "$lib/shared/ui/command";
	import * as Popover from "$lib/shared/ui/popover";
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
	let trigger = $state<HTMLButtonElement | null>(null);
	const visibleValues = $derived(values.slice(0, 5));
	const selectedOutsideVisible = $derived(
		selected !== null && !visibleValues.includes(selected) ? selected : null
	);

	function displayValue(value: string) {
		return `${prefix}${value}`;
	}

	function choose(value: string) {
		onSelect(value);
		open = false;
		void tick().then(() => trigger?.focus());
	}

	function substringFilter(value: string, search: string) {
		return value.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ? 1 : 0;
	}
</script>

{#if values.length > 0}
	<Sidebar.Group>
		<Sidebar.GroupLabel>{label}</Sidebar.GroupLabel>
		<Sidebar.GroupContent>
			<ul class="space-y-0.5">
				{#snippet facetIcon()}
					{#if label === "Projects"}
						<Folder class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					{:else if label === "Priorities"}
						<CircleDot class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					{:else}
						<Tag class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
					{/if}
				{/snippet}
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
							{@render facetIcon()}
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
							{@render facetIcon()}
							<span class="truncate" title={displayValue(selectedOutsideVisible)}
								>{displayValue(selectedOutsideVisible)}</span
							>
							<Check class="ml-auto size-4 shrink-0" aria-hidden="true" />
						</button>
					</li>
				{/if}
				{#if values.length > 5}
					<li>
						<Popover.Root bind:open>
							<Popover.Trigger bind:ref={trigger}>
								{#snippet child({ props })}
									<Button.Root
										{...props}
										variant="ghost"
										class="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-xs font-normal text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
										aria-label={`Show all ${label} values`}
										aria-haspopup="dialog"
										aria-expanded={open}
										{disabled}
									>
										<span>Show all ({values.length})</span>
										<ChevronDown class="size-4" aria-hidden="true" />
									</Button.Root>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content align="start" class="w-56 p-0">
								<Command.Root label={`Search ${label}`} loop filter={substringFilter}>
									<Command.Input
										type="search"
										placeholder={`Search ${label.toLocaleLowerCase()}…`}
										aria-label={`Search ${label}`}
										class="px-3"
									/>
									<Command.List>
										<Command.Empty>No {label.toLocaleLowerCase()} found.</Command.Empty>
										<Command.Group>
											{#each values as value (value)}
												<Command.Item value={displayValue(value)} onSelect={() => choose(value)}>
													<span>{displayValue(value)}</span>
													<Check
														class={cn(
															"ml-auto size-4",
															selected === value ? "opacity-100" : "opacity-0"
														)}
														aria-hidden="true"
													/>
												</Command.Item>
											{/each}
										</Command.Group>
									</Command.List>
								</Command.Root>
							</Popover.Content>
						</Popover.Root>
					</li>
				{/if}
			</ul>
		</Sidebar.GroupContent>
	</Sidebar.Group>
{/if}
