<script lang="ts">
	import { Command as CommandPrimitive } from "bits-ui";
	import { cn } from "cn";

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: CommandPrimitive.InputProps = $props();
</script>

<CommandPrimitive.Input
	bind:ref
	data-slot="command-input"
	class={cn(
		"flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
		className
	)}
	{...restProps}
/>
