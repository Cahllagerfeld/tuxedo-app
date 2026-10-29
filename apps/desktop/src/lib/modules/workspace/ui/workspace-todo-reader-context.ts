import { createContext } from "svelte";
import type { TodoItem } from "#lib/modules/todo/domain/todo.js";
import type { BoardColumn } from "@tuxedo/contracts/board";
import type TodoList from "#lib/modules/todo/ui/TodoList.svelte";
import type { TodoFilterState } from "#lib/modules/todo/state/todo-filter.svelte.js";
import type { WorkspaceCommands } from "../state/workspace-commands.svelte.js";
import type { WorkspaceView } from "../state/workspace-view.js";
import type { createTodoBulkSelection } from "./todo-bulk-selection.svelte.js";
import type { createTodoReaderInteraction } from "./todo-reader-interaction.svelte.js";

type WorkspaceTodoReaderContext = {
	readonly workspace: WorkspaceCommands;
	readonly view: WorkspaceView;
	readonly todoFilter: TodoFilterState;
	readonly filteredTodoItems: readonly TodoItem[];
	readonly bulkSelection: ReturnType<typeof createTodoBulkSelection>;
	readonly selectionMode: boolean;
	readonly reader: ReturnType<typeof createTodoReaderInteraction>;
	surface: ReturnType<typeof TodoList> | undefined;
	viewport: HTMLElement | null;
	onCreate: () => void;
	toggleTodoCompletion: (todo: TodoItem) => Promise<void>;
	deleteTodoItem: (todo: TodoItem, trigger?: HTMLButtonElement | null) => Promise<void>;
	reorderTodoItems: (items: readonly TodoItem[]) => Promise<void>;
	moveTodoOnBoard: (
		todo: TodoItem,
		column: BoardColumn,
		trigger?: HTMLElement | null
	) => Promise<void>;
};

export const [getWorkspaceTodoReader, setWorkspaceTodoReader] =
	createContext<WorkspaceTodoReaderContext>();
