import { getContext, setContext, untrack } from "svelte";
import type { Attachment } from "svelte/attachments";

const key = Symbol("shortcut-scope");
export class ShortcutScope {
	private surfaces = $state(0);
	get available() {
		return this.surfaces === 0;
	}
	surface: Attachment<HTMLElement> = () => {
		untrack(() => this.surfaces++);
		return () => {
			untrack(() => this.surfaces--);
		};
	};
}
export function setShortcutScope() {
	return setContext(key, new ShortcutScope());
}
export function getShortcutScope(): ShortcutScope | undefined {
	return getContext(key);
}
