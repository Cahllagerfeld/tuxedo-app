# New Todo creation — deferred Metadata UI

The initial New Todo form will support a description, Projects, and Contexts. It deliberately excludes Priority and Metadata (`key:value` tokens). Revisit Priority when sorting or filtering makes its control useful. Revisit Metadata as an expandable Properties section with key/value rows once the supported keys and their validation rules are clear.

The initial scope is creation only. Revisit editing existing Todo items, including changing their Projects and Contexts, as a separate feature.

The composer relies on native form and tag-input keyboard behavior. Revisit explicit cross-field and app-wide shortcuts, including Cmd/Ctrl+Enter, Escape, and a shortcut to open the composer, as a dedicated shortcut-system change; evaluate a scoped library such as TanStack Hotkeys then.
