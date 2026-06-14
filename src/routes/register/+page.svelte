<script>
  import AuthForm from '$lib/AuthForm.svelte';
  let { form } = $props();
</script>

<AuthForm mode="register" {form} />
