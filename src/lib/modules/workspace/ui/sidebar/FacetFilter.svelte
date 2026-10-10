<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { Button } from "$lib/shared/ui/button";
	import * as Collapsible from "$lib/shared/ui/collapsible";
	import * as Sidebar from "$lib/shared/ui/sidebar";

	let {
		label,
		values,
		selected,
		search,
		disabled = false,
		onSelect,
	}: {
		label: "Projects" | "Contexts";
		values: readonly string[];
		selected: string | null;
		search: string;
		disabled?: boolean;
		onSelect: (value: string) => void;
	} = $props();

	let expanded = $state(false);
	let contextsOpen = $state(true);
	const prefix = $derived(label === "Projects" ? "+" : "@");
	const matches = $derived(
		values.filter((value) =>
			`${prefix}${value}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())
		)
	);
	const visibleValues = $derived(
		expanded || search ? matches : matches.filter((value, index) => index < 5 || value === selected)
	);
	const hiddenCount = $derived(matches.length - visibleValues.length);
</script>

{#snippet choices()}
	<Sidebar.GroupContent>
		<ul class="space-y-0.5">
			{#each visibleValues as value (value)}
				<li class="min-w-0">
					<Button
						variant={selected === value ? "secondary" : "ghost"}
						class="h-8 w-full max-w-full min-w-0 justify-start gap-2 overflow-hidden px-2 font-normal"
						aria-label={`${prefix}${value}`}
						title={`${prefix}${value}`}
						aria-pressed={selected === value}
						{disabled}
						onclick={() => onSelect(value)}
					>
						<span class="min-w-0 flex-1 truncate text-left">{prefix}{value}</span>
						{#if selected === value}<Check class="size-4 shrink-0" aria-hidden="true" />{/if}
					</Button>
				</li>
			{/each}
		</ul>
		{#if !matches.length}<p class="px-2 py-2 text-xs text-muted-foreground">
				No {label.toLocaleLowerCase()} found.
			</p>{/if}
		{#if !search && (hiddenCount > 0 || expanded)}
			<Button
				variant="ghost"
				size="sm"
				class="mt-1 max-w-full px-2 text-xs font-normal text-muted-foreground"
				aria-label={expanded ? `Show fewer ${label}` : `Show more ${label}`}
				aria-expanded={expanded}
				{disabled}
				onclick={() => (expanded = !expanded)}
				>{expanded ? "Show less" : `Show ${hiddenCount} more`}</Button
			>
		{/if}
	</Sidebar.GroupContent>
{/snippet}

{#if values.length > 0}
	<Sidebar.Group>
		{#if label === "Contexts"}
			<Collapsible.Root
				open={contextsOpen || !!search}
				onOpenChange={(value) => (contextsOpen = value)}
			>
				<Collapsible.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							class="mb-1 h-7 w-full min-w-0 justify-between px-2 text-xs text-muted-foreground"
							>Contexts<ChevronDown
								class={`size-3.5 transition-transform ${!contextsOpen && !search ? "-rotate-90" : ""}`}
								aria-hidden="true"
							/></Button
						>
					{/snippet}
				</Collapsible.Trigger>
				<Collapsible.Content>{@render choices()}</Collapsible.Content>
			</Collapsible.Root>
		{:else}<Sidebar.GroupLabel>{label}</Sidebar.GroupLabel>{@render choices()}{/if}
	</Sidebar.Group>
{/if}
