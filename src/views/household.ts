import type { App } from '../app';

export function renderHouseholdView(app: App) {
  const s = app.state;
  if (!s.household) {
    return `
      <div style="max-width: 400px; margin: 0 auto; padding-top: 60px;">
        <h1 style="justify-content: center; margin-bottom: 32px;"><i class="ph ph-house-line"></i> Peerson</h1>
        <div class="section">
          <div class="form-group">
            <label>Dein Name</label>
            <input type="text" id="userNameInput" value="${s.userName}" placeholder="Wie heißt du?" onchange="app.setUserName(this.value)">
          </div>
          <div class="form-group">
            <label>Haushalt erstellen</label>
            <input type="text" id="newHouseholdName" placeholder="z. B. WG Musterstraße">
            <button class="btn mt-2" onclick="app.createHousehold(document.getElementById('newHouseholdName').value)">
              <i class="ph ph-plus"></i> Erstellen
            </button>
          </div>
          <div style="text-align: center; margin: 20px 0; font-size: 13px; color: var(--text-soft);">— oder —</div>
          <div class="form-group">
            <label>Per Einladung beitreten</label>
            <input type="text" id="inviteCode" placeholder="Einladungscode">
            <button class="btn btn-secondary mt-2" onclick="app.joinFromInvite(document.getElementById('inviteCode').value.trim())">
              <i class="ph ph-sign-in"></i> Beitreten
            </button>
          </div>
        </div>
      </div>
    `;
  }

  const inviteUrl = `${location.origin}?join=${s.household.invite_code}`;
  return `
    <div class="header">
      <h1><i class="ph ph-users"></i> ${s.household.name}</h1>
      <button class="icon-btn" onclick="app.toggleDarkMode()"><i class="ph ph-moon"></i></button>
    </div>
    <div class="section">
      <div class="section-header"><div class="section-title">Mitglieder</div></div>
      ${s.members.map(m => `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${m.name}</div></div>
              <div class="card-meta">${m.role === 'admin' ? 'Admin' : 'Mitglied'}</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="section">
      <div class="section-header"><div class="section-title">Einladung</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <div style="font-size: 13px; color: var(--text-soft);">Link zum Teilen:</div>
          <input type="text" readonly value="${inviteUrl}" onclick="this.select()">
          <div class="flex gap-2">
            <button class="btn btn-small" onclick="navigator.clipboard.writeText('${inviteUrl}'); app.toast('Link kopiert')">Link kopieren</button>
            <button class="btn btn-secondary btn-small" onclick="regenerateInvite()">Neuer Code</button>
          </div>
        </div>
      </div>
    </div>
    <div class="section">
      <button class="btn btn-danger" onclick="leaveHousehold()">Haushalt verlassen</button>
    </div>
    <script>
      async function regenerateInvite() {
        const data = await window.api.households.regenerateInvite(window.app.state.household.id);
        window.app.state.household.invite_code = data.invite_code;
        window.app.render();
        window.app.toast('Neuer Code generiert');
      }
      async function leaveHousehold() {
        if (!confirm('Haushalt wirklich verlassen?')) return;
        await fetch('/api/households', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': window.app.state.userId },
          body: JSON.stringify({ action: 'leave', household_id: window.app.state.household.id, target_user_id: window.app.state.userId })
        });
        localStorage.removeItem('peerson_householdId');
        window.app.state.householdId = null;
        window.app.state.household = null;
        window.app.navigate('household');
        window.app.render();
      }
    </script>
  `;
}
