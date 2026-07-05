import type { App } from '../app';

export function renderHouseholdView(app: App) {
  const s = app.state;
  const isAdmin = app.isAdmin();

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
          <div style="text-align: center; margin: 20px 0; font-size: 13px; color: var(--text-soft);">— oder —</div>
          <div class="form-group">
            <label>Account wiederherstellen</label>
            <input type="text" id="restoreUserId" placeholder="User-ID einfügen">
            <button class="btn btn-secondary mt-2" onclick="restoreAccount()">
              <i class="ph ph-device-mobile"></i> Gerät verbinden
            </button>
            <div style="font-size: 12px; color: var(--text-soft); margin-top: 6px;">
              Deine User-ID findest du im Haushalt-Menü unter "Account"
            </div>
          </div>
        </div>
      </div>
      <script>
        async function restoreAccount() {
          const id = document.getElementById('restoreUserId').value.trim();
          if (!id) return app.toast('Bitte User-ID eingeben');
          app.setUserId(id);
          try {
            // Look up any household(s) this restored account already belongs
            // to, so the same account picks its household back up instead
            // of landing on the create/join screen again.
            const data = await app.api.households.list();
            if (data.households && data.households.length > 0) {
              const household = data.households[0];
              localStorage.setItem('peerson_householdId', household.id);
              app.toast('Account wiederhergestellt');
            } else {
              app.toast('Account wiederhergestellt (kein Haushalt gefunden)');
            }
          } catch (e) {
            app.toast('Account wiederhergestellt — Seite neu laden');
          }
          setTimeout(() => location.reload(), 1200);
        }
      </script>
    `;
  }

  const inviteUrl = `${location.origin}?join=${s.household.invite_code}`;
  return `
    <div class="header">
      <h1><i class="ph ph-users"></i> ${s.household.name}</h1>
      <button class="icon-btn" onclick="app.toggleDarkMode()"><i class="ph ph-moon"></i></button>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Mein Account</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction: column; align-items: stretch; gap: 10px;">
          <div class="form-group" style="margin-bottom: 0;">
            <label style="margin-bottom: 4px;">Name</label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="profileName" value="${s.userName}" placeholder="Dein Name" style="flex: 1;">
              <button class="btn btn-small" style="width: auto;" onclick="saveProfileName()">Speichern</button>
            </div>
          </div>
          <div style="font-size: 12px; color: var(--text-soft);">
            <div>User-ID: <code style="background: var(--bg); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${s.userId}</code></div>
            <div style="margin-top: 4px;">Auf anderen Geräten dieselbe ID einfügen, um denselben Account zu nutzen.</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Mitglieder</div></div>
      ${s.members.map(m => `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header">
                <div class="item-name">${m.name || 'Anonym'}</div>
                ${m.role === 'admin' ? '<span class="badge" style="font-size: 11px; height: 20px; min-width: 20px;">Admin</span>' : ''}
              </div>
              <div class="card-meta">${m.id === s.userId ? 'Du' : 'Mitglied'}</div>
            </div>
          </div>
          ${isAdmin && m.id !== s.userId ? `
          <div class="card-actions">
            <button class="action-btn remove" onclick="kickMember('${m.id}', '${m.name || 'Mitglied'}')" title="Entfernen">
              <i class="ph ph-user-minus"></i>
            </button>
          </div>` : ''}
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
            ${isAdmin ? `<button class="btn btn-secondary btn-small" onclick="regenerateInvite()">Neuer Code</button>` : ''}
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <button class="btn btn-danger" onclick="leaveHousehold()">Haushalt verlassen</button>
    </div>

    <script>
      async function saveProfileName() {
        const name = document.getElementById('profileName').value.trim();
        if (!name) return app.toast('Name erforderlich');
        await app.updateUserName(name);
      }
      async function regenerateInvite() {
        try {
          const data = await app.api.households.regenerateInvite(app.state.household.id);
          app.state.household.invite_code = data.invite_code;
          app.render();
          app.toast('Neuer Code generiert');
        } catch (e) {
          app.toast('Fehler');
        }
      }
      async function kickMember(userId, name) {
        if (!confirm(name + ' wirklich aus dem Haushalt entfernen?')) return;
        try {
          await app.api.households.kick(app.state.household.id, userId);
          app.state.members = app.state.members.filter(m => m.id !== userId);
          app.render();
          app.toast(name + ' entfernt');
        } catch (e) {
          app.toast('Fehler beim Entfernen');
        }
      }
      async function leaveHousehold() {
        if (!confirm('Haushalt wirklich verlassen?')) return;
        try {
          await app.api.households.leave(app.state.household.id, app.state.userId);
        } catch (e) {}
        localStorage.removeItem('peerson_householdId');
        app.state.householdId = null;
        app.state.household = null;
        app.navigate('household');
        app.render();
      }
    </script>
  `;
}
