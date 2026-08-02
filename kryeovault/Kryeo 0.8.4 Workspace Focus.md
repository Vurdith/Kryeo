# Kryeo 0.8.4 Workspace Focus

This release trims the application workspace down to controls that do useful work.

## Changed

- Removed duplicate refresh and reconnect controls from the navigation rail, sidebar, toolbar, and document inspector.
- Kept one contextual `Reconnect Affinity` action in the offline workflows state.
- Hide the pipeline inspector when no active document or job needs attention, giving the workspace its full width.
- Grouped Search and Command Palette controls into one stable toolbar cluster.
- Removed the sidebar connection error card and raw technical error copy from the main workspace.
- Simplified workspace headings and empty states so they describe the next useful action.

## Verification

- Typecheck and production build passed.
- Checked the workflow view at 1482 x 921 and 1002 x 701.
