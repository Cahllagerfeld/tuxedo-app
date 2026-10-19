<script lang="ts">
	import { resolve } from "$app/paths";
	import { Button } from "$lib/shared/ui/button";
	import * as Empty from "$lib/shared/ui/empty";
	let {
		message,
		disabled,
		retry,
	}: { message: string; disabled: boolean; retry: () => Promise<void> } = $props();
	let viewport = $state<HTMLElement>();
	export function focusViewport() {
		viewport?.focus();
	}
</script>

<section
	bind:this={viewport}
	aria-label="Workspace destination"
	tabindex="-1"
	class="flex flex-1 flex-col overflow-auto outline-none"
>
	<Empty.Root class="min-h-full rounded-none border-0">
		<Empty.Header
			><Empty.Title><h1>Workspace unavailable</h1></Empty.Title><Empty.Description
				>{message}</Empty.Description
			></Empty.Header
		>
		<Empty.Content
			><Button {disabled} onclick={retry}>Retry</Button><Button
				variant="outline"
				href={resolve("/workspaces")}
				{disabled}>Home</Button
			></Empty.Content
		>
	</Empty.Root>
</section>
