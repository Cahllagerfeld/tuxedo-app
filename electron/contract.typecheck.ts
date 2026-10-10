// Compiled by check:electron. These expected failures prove transport signatures
// cannot drift silently; an unused @ts-expect-error fails the check.
import type { DesktopAPI } from "../src/lib/shared/desktop/contract";
import { registerDesktopOperation } from "./ipc";
import type { BrowserWindow, IpcMain } from "electron";
declare const api: DesktopAPI;
declare const ipc: IpcMain;
declare const window: BrowserWindow;
const getWindow = () => window;
// @ts-expect-error No generic filesystem operation is exposed.
api.readFile("/etc/passwd");
// @ts-expect-error Read-session requests cannot carry arbitrary filesystem paths.
api.readSession({ path: "/etc/passwd" });
// @ts-expect-error Main cannot register an unknown operation/channel.
registerDesktopOperation(ipc, getWindow, () => true, "arbitraryChannel", api.readSession);
registerDesktopOperation(
	ipc,
	getWindow,
	() => true,
	"readSession",
	// @ts-expect-error Main results must be serialized confirmed outcomes.
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

registerDesktopOperation(ipc, getWindow, () => true, "reorderTodo", api.reorderTodo);
// @ts-expect-error Reordering requires a scoped session and a list of positions.
api.reorderTodo({ lineNumbers: [2, 1] });
