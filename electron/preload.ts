import { contextBridge, ipcRenderer } from "electron";
import {
	createDesktopClient,
	todoFileChangeEvent,
	type TodoFileObservation,
} from "../src/lib/shared/desktop/contract";
const observation: TodoFileObservation = {
	onTodoFileChanged(listener) {
		const receive = (_event: Electron.IpcRendererEvent, payload: unknown) => {
			const parsed = todoFileChangeEvent.payload.safeParse(payload);
			if (parsed.success) listener(parsed.data);
		};
		ipcRenderer.on(todoFileChangeEvent.channel, receive);
		return () => {
			ipcRenderer.removeListener(todoFileChangeEvent.channel, receive);
		};
	},
};
contextBridge.exposeInMainWorld("desktop", {
	...createDesktopClient((channel, request) => ipcRenderer.invoke(channel, request)),
	...observation,
});
