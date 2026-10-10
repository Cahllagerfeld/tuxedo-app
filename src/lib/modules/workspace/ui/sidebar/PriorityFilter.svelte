<script lang="ts">
	import Check from "@lucide/svelte/icons/check";
	import { Button } from "$lib/shared/ui/button";
	import * as Sidebar from "$lib/shared/ui/sidebar";

	let {
		values,
		selected,
		search,
		disabled = false,
		completed = false,
		onSelect,
	}: {
		values: readonly string[];
		selected: string | null;
		search: string;
		disabled?: boolean;
		completed?: boolean;
		onSelect: (value: string) => void;
	} = $props();
	const matches = $derived(
		values.filter((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
	);
</script>

{#if values.length}
	<Sidebar.Group>
		<Sidebar.GroupLabel>Priorities</Sidebar.GroupLabel>
		<Sidebar.GroupContent>
			<div class="flex min-w-0 flex-wrap gap-1.5 px-2">
				{#each matches as priority (priority)}
					<Button
						variant={selected === priority && !completed ? "default" : "outline"}
						size="sm"
						class="min-w-9 gap-1 px-2 font-mono"
						aria-label={`Priority ${priority}`}
						aria-pressed={selected === priority && !completed}
						disabled={disabled || completed}
						onclick={() => onSelect(priority)}
					>
						{#if selected === priority && !completed}<Check
								class="size-3"
								aria-hidden="true"
							/>{/if}{priority}
					</Button>
				{/each}
			</div>
			{#if !matches.length}<p class="px-2 py-2 text-xs text-muted-foreground">
					No priorities found.
				</p>{/if}
			{#if completed}<p class="mt-2 px-2 text-xs text-muted-foreground">
					Priorities apply to Open items.
				</p>{/if}
		</Sidebar.GroupContent>
	</Sidebar.Group>
{/if}
