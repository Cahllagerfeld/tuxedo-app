<script lang="ts">
	import { getAppState } from "@/app/app-context";
	import TodoList from "@/modules/todo/ui/TodoList.svelte";
	import WorkspaceStatus from "@/modules/workspace/ui/WorkspaceStatus.svelte";
	import Button from "@/shared/ui/button/button.svelte";
	import {
		Empty,
		EmptyContent,
		EmptyDescription,
		EmptyHeader,
		EmptyMedia,
		EmptyTitle,
	} from "@/shared/ui/empty";
	import CircleAlert from "@lucide/svelte/icons/circle-alert";
	import FileQuestion from "@lucide/svelte/icons/file-question";
	import FolderOpen from "@lucide/svelte/icons/folder-open";
	import LoaderCircle from "@lucide/svelte/icons/loader-circle";

	const appState = getAppState();
</script>

<div class="flex min-h-full w-full flex-col gap-4 p-4">
	<WorkspaceStatus />

	{#if appState.workspace.isLoading}
		<Empty role="status" aria-live="polite">
			<EmptyMedia variant="icon">
				<LoaderCircle class="animate-spin" />
			</EmptyMedia>
			<EmptyHeader>
				<EmptyTitle>Loading workspace</EmptyTitle>
				<EmptyDescription>Reading the saved workspace and parsing todo.txt.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	{:else if appState.workspace.error}
		<Empty role="alert">
			<EmptyMedia variant="icon">
				<CircleAlert />
			</EmptyMedia>
			<EmptyHeader>
				<EmptyTitle>Workspace unavailable</EmptyTitle>
				<EmptyDescription>
					{appState.workspace.error}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button onclick={appState.workspace.openDirectory}>Choose Workspace</Button>
			</EmptyContent>
		</Empty>
	{:else if !appState.workspace.root}
		<Empty>
			<EmptyMedia variant="icon">
				<FolderOpen />
			</EmptyMedia>
			<EmptyHeader>
				<EmptyTitle>No workspace selected</EmptyTitle>
				<EmptyDescription>
					Choose a directory to load its todo.txt file and remember it for next time.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button onclick={appState.workspace.openDirectory}>Open Workspace</Button>
			</EmptyContent>
		</Empty>
	{:else if !appState.workspace.todoFile}
		<Empty role="status">
			<EmptyMedia variant="icon">
				<FileQuestion />
			</EmptyMedia>
			<EmptyHeader>
				<EmptyTitle>No todo.txt found</EmptyTitle>
				<EmptyDescription>
					Tuxedo looked in {appState.workspace.root}. Add a todo.txt file there or choose a
					different workspace.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="outline" onclick={appState.workspace.openDirectory}>
					Choose Another Workspace
				</Button>
			</EmptyContent>
		</Empty>
	{:else}
		<TodoList />
	{/if}
</div>
