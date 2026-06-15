<script>
  import { onMount } from 'svelte';
  import { store } from '../data/store.js';
  import Modal from '../lib/Modal.svelte';
  import Icon from '../lib/Icon.svelte';

  /**
   * Teams: create a team (you become its manager), invite members by username,
   * and manage the roster. Invitees see pending invitations here and can accept
   * or decline. Members can leave a team. Sharing specific workspaces with a
   * team happens in the Workspaces modal.
   */
  let { onClose } = $props();

  let teams = $state([]);
  let invites = $state([]);
  let loading = $state(true);
  let newTeamName = $state('');
  // Per-team username being invited, keyed by team id.
  let inviteName = $state({});

  // You can be an active member of only one team at a time.
  let onTeam = $derived(teams.length > 0);

  async function reload() {
    const data = await store.listTeams();
    teams = data.teams;
    invites = data.invites;
    loading = false;
  }

  onMount(reload);

  async function createTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    await store.createTeam(name);
    newTeamName = '';
    await reload();
  }

  async function invite(teamId) {
    const username = (inviteName[teamId] ?? '').trim();
    if (!username) return;
    try {
      await store.inviteToTeam(teamId, username);
      inviteName[teamId] = '';
      await reload();
    } catch (e) {
      alert(e?.message ?? 'Could not send the invite.');
    }
  }

  async function removeMember(teamId, m) {
    if (!confirm(`Remove ${m.username} from this team?`)) return;
    await store.removeTeamMember(teamId, m.userId);
    await reload();
  }

  async function deleteTeam(team) {
    if (!confirm(`Delete the team “${team.name}”? Members lose access to anything shared with it.`))
      return;
    await store.deleteTeam(team.id);
    await reload();
  }

  async function accept(teamId) {
    await store.acceptInvite(teamId);
    await reload();
  }

  async function leave(teamId) {
    await store.leaveTeam(teamId);
    await reload();
  }

  // Declining an invitation removes the pending membership — same endpoint.
  const decline = leave;
</script>

<Modal title="Team" width={520} {onClose}>
  <div class="body">
    {#if loading}
      <p class="empty">Loading…</p>
    {:else}
      {#if invites.length}
        <section>
          <h3>Invitations</h3>
          {#if onTeam}
            <p class="note">Leave your current team to accept a new invitation.</p>
          {/if}
          {#each invites as inv (inv.teamId)}
            <div class="row">
              <span class="row-name">{inv.name}</span>
              {#if !onTeam}
                <button class="btn" onclick={() => accept(inv.teamId)}>Accept</button>
              {/if}
              <button class="btn ghost" onclick={() => decline(inv.teamId)}>Decline</button>
            </div>
          {/each}
        </section>
      {/if}

      {#each teams as team (team.id)}
        <section class="team">
          <div class="team-head">
            <h3>{team.name}</h3>
            <span class="role">{team.role === 'manager' ? 'Manager' : 'Member'}</span>
            {#if team.role === 'manager'}
              <button class="icon-btn danger" aria-label="Delete team" onclick={() => deleteTeam(team)}>
                <Icon name="trash-2" size={15} />
              </button>
            {:else}
              <button class="btn ghost" onclick={() => leave(team.id)}>Leave</button>
            {/if}
          </div>

          {#if team.role === 'member'}
            <p class="note">
              Your shared workspaces are visible (read-only) to the manager only. Choose which
              workspaces to share in Manage workspaces.
            </p>
          {/if}

          <div class="members">
            {#each team.members as m (m.userId)}
              <div class="member">
                <span class="row-name">
                  {m.username}
                  {#if m.role === 'manager'}<span class="tag">manager</span>
                  {:else if m.status === 'invited'}<span class="tag muted">invited</span>{/if}
                </span>
                {#if team.role === 'manager' && m.role !== 'manager'}
                  <button
                    class="icon-btn"
                    aria-label="Remove {m.username}"
                    onclick={() => removeMember(team.id, m)}
                  >
                    <Icon name="x" size={15} />
                  </button>
                {/if}
              </div>
            {/each}
          </div>

          {#if team.role === 'manager'}
            <div class="invite">
              <input
                type="text"
                placeholder="Invite by username…"
                bind:value={inviteName[team.id]}
                onkeydown={(e) => e.key === 'Enter' && invite(team.id)}
              />
              <button class="btn" onclick={() => invite(team.id)}>Invite</button>
            </div>
          {/if}
        </section>
      {/each}

      {#if !teams.length && !invites.length}
        <p class="empty">
          You're not on a team yet. Create one below to start sharing.
          <br />
          Waiting on an invite? Reopen this window to check for new ones.
        </p>
      {/if}
    {/if}
  </div>

  {#snippet footer()}
    {#if onTeam}
      <span class="foot-note">You can be on one team at a time.</span>
    {:else}
      <input
        class="new-team"
        type="text"
        placeholder="New team name…"
        bind:value={newTeamName}
        onkeydown={(e) => e.key === 'Enter' && createTeam()}
      />
      <button class="btn" onclick={createTeam}>
        <Icon name="plus" size={15} /> Create team
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .body {
    padding: var(--space-4) var(--space-5);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }
  section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* A divider between stacked sections (e.g. Invitations above a team). */
  section + section {
    border-top: 1px solid var(--border);
    padding-top: var(--space-5);
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .team .team-head h3 {
    font-size: 16px;
    font-weight: 700;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
  }
  .team-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .team-head h3 {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .role {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
    padding: 2px var(--space-2);
    border: 1px solid var(--border);
    border-radius: 999px;
  }
  /* The roster reads as one bordered card with separated rows. */
  .members {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }
  .member {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }
  .member + .member {
    border-top: 1px solid var(--grid-line);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }
  .row-name {
    flex: 1;
    min-width: 0;
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    font-size: 11px;
    color: var(--accent);
    margin-left: var(--space-1);
  }
  .tag.muted {
    color: var(--muted);
  }
  .invite {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .invite input {
    flex: 1;
    min-width: 0;
    height: 34px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-3);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
  }
  .btn:hover {
    background: var(--bg);
  }
  .btn.ghost {
    border-color: transparent;
    color: var(--muted);
  }
  .icon-btn {
    flex: none;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--muted);
    border-radius: var(--radius);
    padding: 0;
  }
  .icon-btn:hover {
    background: var(--bg);
    color: var(--text);
  }
  .icon-btn.danger:hover {
    color: #d63031;
    border-color: #d63031;
  }
  .new-team {
    flex: 1;
    min-width: 0;
    height: 36px;
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
    text-align: center;
    padding: var(--space-4) 0;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .foot-note {
    flex: 1;
    align-self: center;
    font-size: 13px;
    color: var(--muted);
  }
</style>
