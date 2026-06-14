/**
 * The single active timeline drag gesture, shared across every DayColumn.
 *
 * Create/resize never leave their own column, but a *move* can be dragged out
 * of its origin day's column and into another one — and a column can't render a
 * block into a sibling's DOM. Hoisting the live gesture to one shared place lets
 * whichever column the cursor is over render the moving block itself. Only one
 * drag is ever live at a time (you can't drag two blocks at once), so a
 * singleton is the natural fit — same shape as `clock` and `store`.
 */
class TimelineDrag {
  /** @type {null | any} The live gesture, or null when idle. */
  current = $state(null);

  start(gesture) {
    this.current = gesture;
  }

  clear() {
    this.current = null;
  }
}

export const timelineDrag = new TimelineDrag();
