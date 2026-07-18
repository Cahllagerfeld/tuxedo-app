/** Port for Todo-file observation: start/stop/retarget and change signals. */
export interface TodoFileObservationAdapter {
	start(path: string, onChanged: () => void | Promise<void>): void | Promise<void>;
	stop(): void | Promise<void>;
	retarget(path: string | null): void | Promise<void>;
}

/**
 * Test double that records the observed path and lets specs inject change signals.
 * Production binds a Rust/Tauri observation implementation behind the same port.
 */
export class InMemoryTodoFileObservationAdapter implements TodoFileObservationAdapter {
	observedPath: string | null = null;
	private onChanged: (() => void | Promise<void>) | null = null;

	start = (path: string, onChanged: () => void | Promise<void>) => {
		this.observedPath = path;
		this.onChanged = onChanged;
	};

	stop = () => {
		this.observedPath = null;
		this.onChanged = null;
	};

	retarget = (path: string | null) => {
		if (path === null) {
			this.observedPath = null;
			return;
		}
		this.observedPath = path;
	};

	/** Inject a "Todo file may have changed" signal for tests. */
	emitChanged = () => {
		this.onChanged?.();
	};

	/** Like emitChanged, but awaits an async observation handler. */
	emitChangedAsync = async () => {
		await this.onChanged?.();
	};
}
