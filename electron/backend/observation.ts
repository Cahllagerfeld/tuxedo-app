import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

export type TodoFileObservationAdapter = {
	retarget: (path: string | null, changed: () => void) => void;
	stop: () => void;
};

// Observe the directory entry, so atomic replacement does not strand observation
// on the old inode. A quiet interval also covers brief missing-file save flickers.
export function createTodoFileObservation(): TodoFileObservationAdapter {
	let activePath: string | null = null;
	let watcher: FSWatcher | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let notify: (() => void) | undefined;
	const stop = () => {
		activePath = null;
		notify = undefined;
		clearTimeout(timer);
		timer = undefined;
		watcher?.close();
		watcher = undefined;
	};
	return {
		stop,
		retarget(path, changed) {
			if (path === activePath && watcher) {
				notify = changed;
				return;
			}
			stop();
			if (!path) return;
			activePath = path;
			notify = changed;
			const signal = () => {
				clearTimeout(timer);
				timer = setTimeout(() => {
					timer = undefined;
					notify?.();
				}, 250);
			};
			try {
				const started = watch(dirname(path), (_event, filename) => {
					if (filename === null || filename.toString() === basename(path)) signal();
				});
				watcher = started;
				started.on("error", () => {
					if (watcher !== started) return;
					started.close();
					watcher = undefined;
					signal();
				});
			} catch {
				// Observation is best-effort; opening and mutation results stay authoritative.
				stop();
			}
		},
	};
}
