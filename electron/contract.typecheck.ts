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
