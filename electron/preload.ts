import { contextBridge, ipcRenderer } from "electron";
import { createDesktopClient } from "../src/lib/shared/desktop/contract";
contextBridge.exposeInMainWorld(
	"desktop",
	createDesktopClient((channel, request) => ipcRenderer.invoke(channel, request))
);
