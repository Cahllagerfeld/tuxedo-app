// Compiled by check:electron. These expected failures prove transport signatures
// cannot drift silently; an unused @ts-expect-error fails the check.
import type { DesktopAPI } from "@tuxedo/contracts";
import { registerDesktopOperation } from "./ipc";
import type { BrowserWindow, IpcMain } from "electron";
declare const api: DesktopAPI;
declare const ipc: IpcMain;
declare const window: BrowserWindow;
const getWindow = () => window;
// @ts-expect-error No generic filesystem operation is exposed.
api.readFile("/etc/passwd");
// @ts-expect-error Catalogue requests cannot carry arbitrary filesystem paths.
api.readSession({ path: "/etc/passwd" });
registerDesktopOperation(
	ipc,
	getWindow,
	() => true,
	// @ts-expect-error Main cannot register an unknown operation/channel.
	"arbitraryChannel",
	api.readSession
);
registerDesktopOperation(
	ipc,
	getWindow,
	() => true,
	"readSession",
	// @ts-expect-error Main results must be serialized resource outcomes.
	async () => ({ revision: "invalid" })
);

// @ts-expect-error Creation requests require a palette color and a Todo-file reference.
api.createWorkspace({ name: "Work", color: "purple" });
registerDesktopOperation(
	ipc,
	getWindow,
	() => true,
	"createWorkspace",
	// @ts-expect-error Creation must return a serialized domain outcome, not a session.
	api.readSession
);
api.createTodo({
	scope: "9426bd98-a6dd-48eb-b1ab-037d82983ae1",
	revision: 0,
	workspaceId: "550e8400-e29b-41d4-a716-446655440000",
	description: "Buy milk",
	projects: ["Home"],
	contexts: ["errands"],
});
// @ts-expect-error Todo creation requires the scoped mutation target and ordered tag lists.
api.createTodo({ description: "Buy milk" });
registerDesktopOperation(ipc, getWindow, () => true, "createTodo", api.createTodo);
registerDesktopOperation(
	ipc,
	getWindow,
	() => true,
	"createTodo",
	// @ts-expect-error Creation must return a serialized Todo mutation outcome.
	api.readSession
);

registerDesktopOperation(ipc, getWindow, () => true, "bulkDeleteTodos", api.bulkDeleteTodos);
// @ts-expect-error Batch deletion requires scoped expected-content targets, not bare positions.
api.bulkDeleteTodos({ lineNumbers: [1, 2] });

registerDesktopOperation(ipc, getWindow, () => true, "reorderTodo", api.reorderTodo);
// @ts-expect-error Reordering requires a scoped session and a list of positions.
api.reorderTodo({ lineNumbers: [2, 1] });

registerDesktopOperation(ipc, getWindow, () => true, "moveTodoOnBoard", api.moveTodoOnBoard);
// @ts-expect-error Board moves require a scoped item target and a supported destination.
api.moveTodoOnBoard({ column: "archived" });

registerDesktopOperation(
	ipc,
	getWindow,
	() => true,
	"reorderTodosOnBoard",
	api.reorderTodosOnBoard
);
// @ts-expect-error Board reordering requires a scoped session and its displayed targets.
api.reorderTodosOnBoard({ column: "done" });

registerDesktopOperation(ipc, getWindow, () => true, "editTodo", api.editTodo);
// @ts-expect-error Editing needs the original physical line and raw content.
api.editTodo({ description: "Updated", projects: [], contexts: [] });

registerDesktopOperation(ipc, getWindow, () => true, "readSession", api.readSession);
// @ts-expect-error Session reads accept no filesystem path or destination.
api.readSession({ todoPath: "/etc/passwd" });
registerDesktopOperation(ipc, getWindow, () => true, "readWorkspace", api.readWorkspace);
// @ts-expect-error Workspace reads accept a saved identity, never an arbitrary file path.
api.readWorkspace({ workspaceId: "550e8400-e29b-41d4-a716-446655440000", todoPath: "/etc/passwd" });
