import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { dirname, resolve, sep, join } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSessionBackend } from "./backend/session";
import { registerDesktopOperation } from "./ipc";
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
void app.whenReady().then(async () => {
	const backend = createSessionBackend(join(app.getPath("userData"), "workspaces.json"));
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
	});
	session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
		callback(false)
	);
	session.defaultSession.setPermissionCheckHandler(() => false);
	const scriptPolicy = devOrigin
		? "'unsafe-inline'"
		: [
				...readFileSync(resolve(here, "../build/index.html"), "utf8").matchAll(
					/<script\b[^>]*>([\s\S]*?)<\/script>/g
				),
			]
				.filter((match) => match[1])
				.map((match) => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`)
				.join(" ");
	session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
		const csp = `default-src 'self'; script-src 'self' ${scriptPolicy}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${devOrigin ? ` ${devOrigin.replace("http:", "ws:")}` : ""}; object-src 'none'; frame-src 'none'; base-uri 'none'`;
		callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
	});
	const window = new BrowserWindow({
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
	});
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
	registerDesktopOperation(ipcMain, window, trusted, "readSession", backend.readSession);
	registerDesktopOperation(
		ipcMain,
		window,
		trusted,
		"setTodoCompletion",
		backend.setTodoCompletion
	);
	registerDesktopOperation(ipcMain, window, trusted, "deleteTodo", backend.deleteTodo);
	registerDesktopOperation(ipcMain, window, trusted, "switchWorkspace", backend.switchWorkspace);
	registerDesktopOperation(ipcMain, window, trusted, "restoreSession", backend.restoreSession);
	registerDesktopOperation(ipcMain, window, trusted, "createWorkspace", backend.createWorkspace);
	registerDesktopOperation(ipcMain, window, trusted, "deleteWorkspace", backend.deleteWorkspace);
	registerDesktopOperation(ipcMain, window, trusted, "selectTodoFile", async () => {
		const result = await dialog.showOpenDialog(window, {
			title: "Choose Todo file",
			properties: ["openFile"],
		});
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});
	await window.loadURL(devOrigin ?? "tuxedo://app/");
	app.on("window-all-closed", () => app.quit());
});
