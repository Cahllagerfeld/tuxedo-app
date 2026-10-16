import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	ipcMain,
	nativeTheme,
	net,
	protocol,
	session,
} from "electron";
import { dirname, resolve, sep, join } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Exit, Scope } from "effect";
import { WorkspaceSession } from "./backend/session";
import { createSessionRuntime, desktopSessionBackend } from "./backend/session-runtime";
import { registerDesktopOperation } from "./ipc";
import { createTodoFileObservation } from "./backend/observation";
import {
	todoFileChangeEvent,
	type DesktopOperation,
	type DesktopRequest,
	type DesktopResponse,
} from "../src/lib/shared/desktop/contract";
const here = dirname(fileURLToPath(import.meta.url));
app.setName("Tuxedo Electron");
app.setPath(
	"userData",
	process.env.TUXEDO_USER_DATA ?? join(app.getPath("appData"), "Tuxedo Electron")
);
protocol.registerSchemesAsPrivileged([
	{ scheme: "tuxedo", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const devOrigin = app.isPackaged ? undefined : process.env.TUXEDO_RENDERER_ORIGIN;
if (devOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(devOrigin))
	throw Error("Development requires a configured loopback origin");
const trusted = (url: string) => {
	try {
		const parsed = new URL(url);
		return devOrigin
			? parsed.origin === devOrigin
			: parsed.protocol === "tuxedo:" && parsed.host === "app";
	} catch {
		return false;
	}
};
let mainWindow: BrowserWindow | null = null;

const observation = createTodoFileObservation();
const runtime = createSessionRuntime(
	join(app.getPath("userData"), "workspaces.json"),
	observation,
	(event) => {
		if (mainWindow && !mainWindow.isDestroyed() && trusted(mainWindow.webContents.getURL()))
			mainWindow.webContents.send(
				todoFileChangeEvent.channel,
				todoFileChangeEvent.payload.parse(event)
			);
	}
);
const backend = desktopSessionBackend(runtime);
let quitAllowed = false;
let quitting = false;
app.on("before-quit", (event) => {
	if (quitAllowed) return;
	event.preventDefault();
	if (quitting) return;
	quitting = true;
	void backend.shutdown().then((result) => {
		if (result !== "complete") {
			app.exit(1);
			return;
		}
		quitAllowed = true;
		app.quit();
	});
});
const owned = (acquire: () => void, release: () => void) =>
	Effect.acquireRelease(Effect.sync(acquire), () => Effect.sync(release));
const startup = Effect.gen(function* () {
	yield* Effect.promise(() => app.whenReady());
	const windowsClosed = () => {
		if (process.platform !== "darwin" && !quitting) app.quit();
	};
	yield* owned(
		() => app.on("window-all-closed", windowsClosed),
		() => app.removeListener("window-all-closed", windowsClosed)
	);
	yield* owned(
		() =>
			protocol.handle("tuxedo", (request) => {
				const url = new URL(request.url);
				if (url.host !== "app" || request.method !== "GET")
					return new Response("Forbidden", { status: 403 });
				const root = resolve(here, "../build");
				let path: string;
				try {
					path = resolve(root, "." + decodeURIComponent(url.pathname));
				} catch {
					return new Response("Invalid path", { status: 400 });
				}
				if (path !== root && !path.startsWith(root + sep))
					return new Response("Forbidden", { status: 403 });
				if (url.pathname === "/" || !url.pathname.split("/").pop()?.includes("."))
					path = join(root, "index.html");
				return net.fetch(pathToFileURL(path).href);
			}),
		() => protocol.unhandle("tuxedo")
	);
	yield* owned(
		() => {
			session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
				callback(false)
			);
			session.defaultSession.setPermissionCheckHandler(() => false);
		},
		() => {
			session.defaultSession.setPermissionRequestHandler(null);
			session.defaultSession.setPermissionCheckHandler(null);
		}
	);
	const scriptPolicy = yield* Effect.sync(() =>
		devOrigin
			? "'unsafe-inline'"
			: [
					...readFileSync(resolve(here, "../build/index.html"), "utf8").matchAll(
						/<script\b[^>]*>([\s\S]*?)<\/script>/g
					),
				]
					.filter((match) => match[1])
					.map((match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`)
					.join(" ")
	);
	yield* owned(
		() =>
			session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
				const csp = `default-src 'self'; script-src 'self' ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${devOrigin ? ` ${devOrigin.replace("http:", "ws:")}` : ""}; object-src 'none'; frame-src 'none'; base-uri 'none'`;
				callback({
					responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] },
				});
			}),
		() => session.defaultSession.webRequest.onHeadersReceived(null)
	);
	const applicationScope = yield* Effect.scope;
	const createWindow = Effect.gen(function* () {
		const windowScope = yield* Scope.fork(applicationScope);
		yield* Effect.gen(function* () {
			const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? "#242424" : "#eeeeee");
			const window = yield* Effect.acquireRelease(
				Effect.sync(
					() =>
						new BrowserWindow({
							show: false,
							backgroundColor: backgroundColor(),
							width: 1200,
							height: 850,
							...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
							webPreferences: {
								preload: join(here, "preload.cjs"),
								sandbox: true,
								contextIsolation: true,
								nodeIntegration: false,
								webSecurity: true,
							},
						})
				),
				(window) =>
					Effect.sync(() => {
						if (!window.isDestroyed()) window.destroy();
					})
			);
			mainWindow = window;
			const updateBackground = () => window.setBackgroundColor(backgroundColor());
			yield* owned(
				() => nativeTheme.on("updated", updateBackground),
				() => nativeTheme.removeListener("updated", updateBackground)
			);
			window.once("ready-to-show", () => {
				if (process.env.TUXEDO_TEST_HIDDEN === "1") return;
				window.maximize();
				window.show();
			});
			const closed = () => {
				if (mainWindow === window) mainWindow = null;
				if (!quitting)
					void backend
						.run(
							"window closed",
							Scope.close(windowScope, Exit.void).pipe(
								Effect.andThen(WorkspaceSession.use((session) => session.stopObservation))
							)
						)
						.catch((error) => console.error("Window release failed", error));
			};
			yield* owned(
				() => window.on("closed", closed),
				() => {
					window.removeListener("closed", closed);
					if (mainWindow === window) mainWindow = null;
				}
			);
			window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
			window.webContents.on("will-navigate", (event, url) => {
				if (!trusted(url)) event.preventDefault();
			});
			window.webContents.on("will-redirect", (event, url) => {
				if (!trusted(url)) event.preventDefault();
			});
			window.webContents.on("will-frame-navigate", (event) => {
				if (!trusted(event.url)) event.preventDefault();
			});
			window.webContents.on("will-attach-webview", (event) => event.preventDefault());
			yield* Effect.promise(() => window.loadURL(devOrigin ?? "tuxedo://app/"));
		}).pipe(Scope.provide(windowScope));
	});
	const getWindow = () => mainWindow;
	const register = <K extends DesktopOperation>(
		operation: K,
		handler: (request: DesktopRequest<K>) => Promise<DesktopResponse<K>>
	) =>
		Effect.acquireRelease(
			Effect.sync(() => registerDesktopOperation(ipcMain, getWindow, trusted, operation, handler)),
			(release) => Effect.sync(release)
		);
	yield* register("writeClipboardText", ({ text }) =>
		backend.run(
			"writeClipboardText",
			Effect.tryPromise(async () => {
				await clipboard.writeText(text);
				return null;
			})
		)
	);
	yield* register("readSession", backend.readSession);
	yield* register("setWorkspaceSortOrder", backend.setWorkspaceSortOrder);
	yield* register("setWorkspaceShowDeferred", backend.setWorkspaceShowDeferred);
	yield* register("undoTodo", backend.undoTodo);
	yield* register("readSavedViews", backend.readSavedViews);
	yield* register("saveView", backend.saveView);
	yield* register("deleteView", backend.deleteView);
	yield* register("setTodoCompletion", backend.setTodoCompletion);
	yield* register("bulkSetTodoCompletion", backend.bulkSetTodoCompletion);
	yield* register("deleteTodo", backend.deleteTodo);
	yield* register("editTodo", backend.editTodo);
	yield* register("reorderTodo", backend.reorderTodo);
	yield* register("createTodo", backend.createTodo);
	yield* register("switchWorkspace", backend.switchWorkspace);
	yield* register("restoreSession", backend.restoreSession);
	yield* register("createWorkspace", backend.createWorkspace);
	yield* register("deleteWorkspace", backend.deleteWorkspace);

	yield* Effect.acquireRelease(
		Effect.sync(() =>
			registerDesktopOperation(ipcMain, getWindow, trusted, "selectTodoFile", () =>
				backend.run(
					"selectTodoFile",
					Effect.promise(async () => {
						if (!mainWindow) throw Error("No application window");
						const result = await dialog.showOpenDialog(mainWindow, {
							title: "Choose Todo file",
							properties: ["openFile"],
						});
						return result.canceled ? null : (result.filePaths[0] ?? null);
					})
				)
			)
		),
		(release) => Effect.sync(release)
	);
	const activate = () => {
		if (!quitting && BrowserWindow.getAllWindows().length === 0)
			void backend.run("activate", createWindow).catch(startupFailed);
	};
	yield* owned(
		() => app.on("activate", activate),
		() => app.removeListener("activate", activate)
	);
	yield* createWindow;
});
function startupFailed(error: unknown) {
	console.error("Desktop startup failed", error);
	quitting = true;
	void backend.shutdown().then(() => app.exit(1));
}
void backend.run("startup", startup).catch(startupFailed);
