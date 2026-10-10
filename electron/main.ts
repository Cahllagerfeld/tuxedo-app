import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, session } from "electron";
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
let mainWindow: BrowserWindow | null = null;

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});

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
	const createWindow = async () => {
		const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? "#333333" : "#fafafa");
		const window = new BrowserWindow({
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
		});
		mainWindow = window;
		const updateBackground = () => window.setBackgroundColor(backgroundColor());
		nativeTheme.on("updated", updateBackground);
		window.once("ready-to-show", () => {
			window.maximize();
			window.show();
		});
		window.on("closed", () => {
			nativeTheme.removeListener("updated", updateBackground);
			if (mainWindow === window) mainWindow = null;
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
		await window.loadURL(devOrigin ?? "tuxedo://app/");
	};
	const getWindow = () => mainWindow;
	registerDesktopOperation(ipcMain, getWindow, trusted, "readSession", backend.readSession);
	registerDesktopOperation(
		ipcMain,
		getWindow,
		trusted,
		"setTodoCompletion",
		backend.setTodoCompletion
	);
	registerDesktopOperation(ipcMain, getWindow, trusted, "deleteTodo", backend.deleteTodo);
	registerDesktopOperation(ipcMain, getWindow, trusted, "reorderTodo", backend.reorderTodo);
	registerDesktopOperation(ipcMain, getWindow, trusted, "createTodo", backend.createTodo);
	registerDesktopOperation(ipcMain, getWindow, trusted, "switchWorkspace", backend.switchWorkspace);
	registerDesktopOperation(ipcMain, getWindow, trusted, "restoreSession", backend.restoreSession);
	registerDesktopOperation(ipcMain, getWindow, trusted, "createWorkspace", backend.createWorkspace);
	registerDesktopOperation(ipcMain, getWindow, trusted, "deleteWorkspace", backend.deleteWorkspace);
	registerDesktopOperation(ipcMain, getWindow, trusted, "selectTodoFile", async () => {
		if (!mainWindow) throw Error("No application window");
		const result = await dialog.showOpenDialog(mainWindow, {
			title: "Choose Todo file",
			properties: ["openFile"],
		});
		return result.canceled ? null : (result.filePaths[0] ?? null);
	});
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) void createWindow();
	});
	await createWindow();
});
