<script lang="ts">
	import XIcon from "@lucide/svelte/icons/x";

	type Props = {
		prefix: string;
		value: string;
		disabled: boolean | null;
		active: boolean;
		onDelete: (value: string) => void;
	};

	let { value, prefix, disabled, onDelete, active }: Props = $props();
</script>

<div
	class="flex place-items-center gap-2 rounded-md bg-secondary px-2 py-0.5 ring-offset-background transition-all hover:cursor-default hover:bg-secondary/90 aria-selected:bg-secondary/90 aria-selected:ring-2 aria-selected:ring-ring aria-selected:ring-offset-2"
	data-selected={active}
>
	<span>{prefix}{value}</span>
	<button
		type="button"
		aria-label={`Remove ${prefix}${value}`}
		{disabled}
		onclick={() => onDelete(value)}
	>
		<XIcon class="size-4" />
	</button>
</div>
