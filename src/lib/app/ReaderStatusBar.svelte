<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";

	type Props = {
		activeWorkspace: Workspace | null;
		todoFile: TodoFile | null;
		todoSummary: TodoFileSummary;
	};

	let { activeWorkspace, todoFile, todoSummary }: Props = $props();
	const todoFileName = $derived(todoFile?.path.split(/[\\/]/).at(-1) ?? "");
</script>

<footer
	aria-label="Reader status"
	class="flex h-8 items-center gap-2 border-t border-border bg-card px-4 font-mono text-xs text-muted-foreground"
>
	{#if todoFile && activeWorkspace}
		<span>Workspace: {activeWorkspace.name}</span>
		<span aria-hidden="true">·</span>
		<span>Todo file: {todoFileName}</span>
		<span aria-hidden="true">·</span>
		<span>{todoSummary.counts.total} parsed</span>
		<span aria-hidden="true">·</span>
		<span>{todoSummary.counts.completed} completed</span>
		<span aria-hidden="true">·</span>
		<span>{todoSummary.counts.open} pending</span>
		{#if todoSummary.counts.skipped > 0}
			<span aria-hidden="true">·</span>
			<span
				>{todoSummary.counts.skipped} skipped line{todoSummary.counts.skipped === 1
					? ""
					: "s"}</span
			>
		{/if}
	{/if}
</footer>
