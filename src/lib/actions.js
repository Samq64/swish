/** Reusable Svelte actions. */

/**
 * Focus a node on mount; pass `{ select: true }` to also select its contents.
 * `use:autofocus` or `use:autofocus={{ select: true }}`.
 */
export function autofocus(node, { select = false } = {}) {
  node.focus();
  if (select) node.select?.();
}

/**
 * Call `handler` when a pointer press lands outside `node` — e.g. to close a
 * dropdown. `use:clickOutside={() => (open = false)}`.
 */
export function clickOutside(node, handler) {
  const onDown = (e) => {
    if (!node.contains(e.target)) handler?.(e);
  };
  window.addEventListener('pointerdown', onDown);
  return {
    update(next) {
      handler = next;
    },
    destroy() {
      window.removeEventListener('pointerdown', onDown);
    },
  };
}
