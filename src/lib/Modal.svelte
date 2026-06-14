<script>
  import Icon from './Icon.svelte';

  /**
   * Centered modal dialog shell shared by the app's modals. Handles the dimmed
   * backdrop, dismissal (Escape, backdrop click, or the header's × button), and
   * the titled header. Consumers pass the body as children and, optionally, a
   * `footer` snippet for primary actions — modals whose × is the only way out
   * just omit it.
   */
  let { title, width = 460, onClose, children, footer } = $props();

  function onKeydown(event) {
    if (event.key === 'Escape') onClose?.();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div
  class="backdrop"
  role="presentation"
  onpointerdown={(e) => {
    if (e.target === e.currentTarget) onClose?.();
  }}
>
  <div
    class="modal"
    style:width="{width}px"
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <header class="head">
      <h2>{title}</h2>
      <button class="close" aria-label="Close" onclick={() => onClose?.()}>
        <Icon name="x" size={18} />
      </button>
    </header>

    {@render children()}

    {#if footer}
      <footer class="foot">{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(20, 20, 30, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
  }
  .head h2 {
    margin: 0;
    font-size: 17px;
  }
  .close {
    border: none;
    background: none;
    line-height: 1;
    color: var(--muted);
    padding: 0 var(--space-1);
  }
  .foot {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--border);
  }
</style>
