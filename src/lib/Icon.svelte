<script>
  /**
   * Renders an SVG from src/lib/icons inline (not via <img>) so it inherits
   * `currentColor` and themes with the surrounding text. Usage:
   *   <Icon name="chevron-left" />  <Icon name="trash-2" size={16} />
   */
  const files = import.meta.glob('./icons/*.svg', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const icons = {};
  for (const [path, svg] of Object.entries(files)) {
    icons[path.split('/').pop().replace('.svg', '')] = svg;
  }

  let { name, size = 18, class: klass = '' } = $props();
</script>

<span class="icon {klass}" style:--icon-size="{size}px" aria-hidden="true">
  {@html icons[name] ?? ''}
</span>

<style>
  .icon {
    display: inline-flex;
    flex: none;
    line-height: 0;
  }
  .icon :global(svg) {
    width: var(--icon-size);
    height: var(--icon-size);
  }
</style>
