<script>
  import { store } from '../data/store.js';
  import EditPopover from './EditPopover.svelte';

  /**
   * Hosts the shared entry editor for the timeline and list views. Both select
   * an entry (`selectedId`) and measure its on-screen `anchor` plus the `bounds`
   * the popover may occupy; this owns the entry lookup and all the store wiring
   * (edit, stop, delete, create-tag, read-only) so the views don't repeat it.
   *
   * The {#key} gives each selection a fresh EditPopover instance, so its
   * callbacks stay bound to this entry's id — a pending description edit flushed
   * as the editor tears down still targets the entry it was editing, not the
   * next one. `onClose` clears the parent's selection.
   */
  let { selectedId, anchor, bounds, onClose } = $props();

  let entry = $derived(
    selectedId ? (store.entries.find((e) => e.id === selectedId) ?? null) : null,
  );
</script>

{#if entry}
  {@const sid = entry.id}
  {#key sid}
    <EditPopover
      {entry}
      projects={store.projects}
      tags={store.tags}
      {anchor}
      {bounds}
      running={entry.end === null}
      readOnly={store.readOnly}
      onCreateTag={(name) => store.addTag({ name })}
      onChange={(patch) => store.update(sid, patch)}
      onStop={() => store.stop(sid)}
      onDelete={() => {
        store.remove(sid);
        onClose?.();
      }}
      onClose={() => onClose?.()}
    />
  {/key}
{/if}
