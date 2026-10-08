<script lang="ts">
	import type { TodoFile } from "$lib/modules/todo/domain/todo";
	import type { TodoFileSummary } from "$lib/modules/todo/domain/todo-file-summary";
	import type { Workspace } from "$lib/modules/workspace/domain/workspace";
	import type { WorkspaceSessionOperation } from "$lib/modules/workspace/state/workspace-session-types";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";

	type Props = {
		activeWorkspace: Workspace | null;
		todoFile: TodoFile | null;
		todoSummary: TodoFileSummary;
		pendingOperation?: WorkspaceSessionOperation | null;
	};

	let { activeWorkspace, todoFile, todoSummary, pendingOperation = null }: Props = $props();
	const todoFileName = $derived(todoFile?.path.split(/[\\/]/).at(-1) ?? "");
</script>

<footer
	aria-label="Reader status"
	class="flex h-8 shrink-0 items-center gap-2 overflow-hidden border-t border-border bg-card px-4 font-mono text-xs text-muted-foreground"
>
	{#if todoFile && activeWorkspace}
		<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
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
		</div>
		{#if pendingOperation === "set_todo_item_completion" || pendingOperation === "delete_todo_item"}
			<span class="flex shrink-0 items-center gap-2 whitespace-nowrap" role="status">
				<LoaderCircle class="size-3 animate-spin" aria-hidden="true" />
				Updating Todo file…
			</span>
		{/if}
	{/if}
</footer>
