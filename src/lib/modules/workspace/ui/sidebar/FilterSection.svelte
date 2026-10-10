<script lang="ts">
	import type { Snippet } from "svelte";
	import ChevronDown from "@lucide/svelte/icons/chevron-down";
	import { Button } from "$lib/shared/ui/button";
	import * as Collapsible from "$lib/shared/ui/collapsible";
	import * as Sidebar from "$lib/shared/ui/sidebar";

	let { label, search, children }: { label: string; search: string; children: Snippet } = $props();
	let open = $state(true);
	const visible = $derived(open || !!search);
</script>

<Sidebar.Group>
	<Collapsible.Root open={visible} onOpenChange={(value) => (open = value)}>
		<Collapsible.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					class="mb-1 h-7 w-full min-w-0 justify-between px-2 text-xs text-muted-foreground"
					>{label}<ChevronDown
						class={`size-3.5 transition-transform ${visible ? "" : "-rotate-90"}`}
						aria-hidden="true"
					/></Button
				>
			{/snippet}
		</Collapsible.Trigger>
		<Collapsible.Content>{@render children()}</Collapsible.Content>
	</Collapsible.Root>
</Sidebar.Group>
