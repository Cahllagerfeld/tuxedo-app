<script lang="ts">
	import { cn } from "@/shared/utils";

	type StatCardProps = {
		label: string;
		value: number;
		color?: string;
	};
	let { label, value, color = "text-foreground" }: StatCardProps = $props();
</script>

<div class="rounded-lg bg-secondary/50 p-2.5">
	<div class={cn("font-mono text-lg font-bold", color)}>{value}</div>
	<div class="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</div>
</div>
