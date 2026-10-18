<script lang="ts">
	import { Button } from "$lib/shared/ui/button";
	import * as DropdownMenu from "$lib/shared/ui/dropdown-menu";
	import Ellipsis from "@lucide/svelte/icons/ellipsis";
	import Trash2 from "@lucide/svelte/icons/trash-2";

	let {
		workspaceName,
		disabled,
		nested = false,
		onRemove,
	}: {
		workspaceName: string;
		disabled: boolean;
		nested?: boolean;
		onRemove: () => void;
	} = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger {disabled}>
		{#snippet child({ props })}
			{#if nested}
				<DropdownMenu.Item
					{...props}
					{disabled}
					closeOnSelect={false}
					aria-label={`Options for ${workspaceName}`}
					class="shrink-0 hover:bg-accent hover:text-accent-foreground"
				>
					<Ellipsis aria-hidden="true" />
				</DropdownMenu.Item>
			{:else}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					{disabled}
					aria-label={`Options for ${workspaceName}`}
				>
					<Ellipsis aria-hidden="true" />
				</Button>
			{/if}
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content
		side={nested ? "right" : "bottom"}
		align={nested ? "start" : "end"}
		class="w-auto"
	>
		<DropdownMenu.Item
			variant="destructive"
			{disabled}
			onclick={onRemove}
			class="whitespace-nowrap"
		>
			<Trash2 aria-hidden="true" />Remove workspace
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
