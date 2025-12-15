# Editing ergonomics

## Autosave
- Autosave is enabled by default and appears as a toggle in the toolbar. The status text shows "Autosave pending" while changes are queued, "Saving…" during persistence, and the last saved time when complete.
- Autosave is debounced to avoid spamming the server; it triggers roughly 1.5 seconds after the last change when a workspace is loaded.
- When a save fails (e.g., validation), the status switches to an error message and autosave is disabled to prevent retries. Re-enable the toggle after fixing issues to resume autosave.
- Autosave is inactive when no workspace is loaded; use manual Save in that state.

## Undo / Redo
- Undo/Redo buttons live in the toolbar and respond to **Cmd/Ctrl+Z** (undo), **Cmd/Ctrl+Shift+Z**, or **Cmd/Ctrl+Y** (redo). Shortcuts are ignored while typing in text inputs.
- Undo/redo covers element create/delete, rename/property edits, relationship add/remove, diagram node add/remove, and node movement.
- History uses a bounded stack (about 30 steps) to keep memory stable. Undo/redo updates the model browser, canvas, selection, and properties in lockstep.

## Diagram productivity (multi-select, copy/paste)
- Shift+click toggles diagram node selection; click empty space (or press **Esc**) to clear.
- Dragging from empty canvas space draws a marquee to select multiple nodes; dragging any selected node moves all selected nodes together.
- **Delete/Backspace** removes the selected diagram nodes (semantic elements remain), and edges attached to those nodes are pruned.
- Copy/paste/duplicate are diagram-only: **Cmd/Ctrl+C** copies selected nodes, **Cmd/Ctrl+V** pastes with a small offset and new node IDs, and **Cmd/Ctrl+D** duplicates. Semantic elements and relationships are reused; edges are not copied in this MVP.

## Testing guidance
- Toggle autosave on and off while editing; ensure the status reflects pending and saved states.
- Exercise undo/redo after each major action (create, rename, drag nodes, connect blocks) and confirm the diagram and tree stay in sync.
- After an undo/redo, autosave should persist the current state once it stabilizes.
