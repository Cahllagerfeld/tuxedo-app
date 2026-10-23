import type { BrowserWindow, IpcMain } from "electron";
import {
	desktopContract,
	type DesktopOperation,
	type DesktopRequest,
	type DesktopResponse,
} from "@tuxedo/contracts";
type Request<K extends DesktopOperation> = DesktopRequest<K>;
type Response<K extends DesktopOperation> = DesktopResponse<K>;
export function registerDesktopOperation<K extends DesktopOperation>(
	ipc: IpcMain,
	getWindow: () => BrowserWindow | null,
	trusted: (url: string) => boolean,
	operation: K,
	handler: (request: Request<K>) => Promise<Response<K>>
): () => void {
	const contract = desktopContract[operation];
	ipc.handle(contract.channel, async (event, request: unknown) => {
		const window = getWindow();
		if (
			!window ||
			event.sender !== window.webContents ||
			event.senderFrame !== window.webContents.mainFrame ||
			!trusted(event.senderFrame.url)
		)
			throw Error("Untrusted desktop sender");
		// The keyed schema is the source of truth for this operation at both boundaries.
		const input = contract.request.parse(request) as Request<K>;
		return contract.response.parse(await handler(input));
	});
	return () => ipc.removeHandler(contract.channel);
}
