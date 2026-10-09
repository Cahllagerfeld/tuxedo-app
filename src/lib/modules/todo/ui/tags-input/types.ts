import type { HTMLInputAttributes } from "svelte/elements";

export type TagsInputPropsWithoutHTML = {
	prefix?: string;
	value?: string[];
	validate?: (value: string, tags: string[]) => string | undefined;
	onValueChange?: (value: string[]) => void;
	onInvalidChange?: (message: string | undefined) => void;
	suggestions?: string[];
	filterSuggestions?: (inputValue: string, suggestions: string[]) => string[];
	restrictToSuggestions?: boolean;
};

export type TagsInputProps = TagsInputPropsWithoutHTML & Omit<HTMLInputAttributes, "value">;
