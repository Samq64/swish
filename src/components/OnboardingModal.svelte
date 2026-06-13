<script>
  /**
   * First-visit modal explaining that all data lives in this browser's local
   * storage, and how to back it up via workspace export.
   */
  let { onClose } = $props();

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
  <div class="modal" role="dialog" aria-modal="true" aria-label="Welcome">
    <header class="head">
      <h2>Welcome</h2>
    </header>

    <div class="body">
      <p>
        This app keeps everything — time entries, projects, tags and
        workspaces — in <strong>this browser's local storage</strong>. There's
        no account, and nothing is sent to a server.
      </p>
      <ul>
        <li>
          Your data stays on <strong>this device and browser only</strong> — it
          won't sync to your phone or other browsers.
        </li>
        <li>
          <strong>Clearing your browser data erases it</strong>, and there's no
          cloud backup.
        </li>
      </ul>
      <p class="tip">
        To back up or move your data, open the <strong>workspace menu</strong>
        (top-left) and choose <strong>Export</strong> to download a JSON file.
        <strong>Import</strong> brings it back — on this browser or another.
      </p>
    </div>

    <footer class="foot">
      <button class="done" onclick={() => onClose?.()}>Got it</button>
    </footer>
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
    padding: var(--space-4);
  }
  .modal {
    width: 440px;
    max-width: 100%;
    max-height: calc(100vh - 64px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  .head {
    padding: var(--space-4) var(--space-5) var(--space-2);
  }
  .head h2 {
    margin: 0;
    font-size: 19px;
    color: var(--accent);
  }
  .body {
    padding: 0 var(--space-5);
    overflow-y: auto;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text);
  }
  .body p {
    margin: 0 0 var(--space-3);
  }
  .body ul {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .tip {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: var(--space-3);
    color: var(--text);
  }
  .foot {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-3) var(--space-5) var(--space-4);
  }
  .done {
    border: none;
    background: var(--accent);
    color: white;
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-5);
    font-weight: 600;
    font-size: 14px;
  }
</style>
