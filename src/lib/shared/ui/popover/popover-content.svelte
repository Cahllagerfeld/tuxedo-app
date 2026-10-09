<script lang="ts">
	import { Popover as PopoverPrimitive } from "bits-ui";
	import { cn } from "cn";
	import Portal from "./popover-portal.svelte";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: PopoverPrimitive.ContentProps = $props();
</script>

<Portal>
	<PopoverPrimitive.Content
		bind:ref
		data-slot="popover-content"
		class={cn(
			"z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</PopoverPrimitive.Content>
</Portal>
