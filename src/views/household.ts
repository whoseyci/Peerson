import type { App } from '../app';
import type { Location } from '../types';

interface LocationNode extends Location {
  children: LocationNode[];
}

function buildLocationTree(flat: Location[]): LocationNode[] {
  const byId = new Map<string, LocationNode>();
  flat.forEach(l => byId.set(l.id, { ...l, children: [] }));
  const roots: LocationNode[] = [];
  byId.forEach(node => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function renderLocationTree(nodes: LocationNode[], depth: number): string {
  if (!nodes.length) return '';
  return nodes
    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
    .map(node => {
      const indent = depth * 16;
      return `
        <div class="location-tree-row" style="padding-left: ${indent}px;">
          <span class="location-name"><i class="ph ph-folder"></i> ${node.name}</span>
          <span class="location-actions">
            <button class="icon-btn btn-mini" onclick="addChildLocation('${node.id}')" title="Unterort hinzufügen"><i class="ph ph-plus"></i></button>
            <button class="icon-btn btn-mini" onclick="renameLocation('${node.id}', '${node.name.replace(/'/g, "\\'")}')" title="Umbenennen"><i class="ph ph-pencil-simple"></i></button>
            <button class="icon-btn btn-mini" onclick="deleteLocation('${node.id}', '${node.name.replace(/'/g, "\\'")}')" title="Löschen"><i class="ph ph-trash"></i></button>
          </span>
        </div>
        ${renderLocationTree(node.children, depth + 1)}
      `;
    }).join('');
}

export function renderHouseholdView(app: App) {
  const s = app.state;

  if (!s.householdId || !s.household) {
    return `
      <div class="header"><h1><i class="ph ph-users"></i> Haushalt</h1></div>
      <div class="section">
        <div class="card">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>Haushalt erstellen</label>
            <input type="text" id="newHouseholdName" placeholder="Name (z. B. WG Mitte)">
            <button class="btn mt-2" onclick="createHousehold()"><i class="ph-bold ph-plus"></i> Erstellen</button>
          </div>
        </div>
        <div class="card mt-3">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>Oder mit Code beitreten</label>
            <input type="text" id="joinCode" placeholder="8-stelliger Code">
            <button class="btn btn-secondary mt-2" onclick="joinHousehold()"><i class="ph-bold ph-sign-in"></i> Beitreten</button>
          </div>
        </div>
        <div class="card mt-3">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>Account wiederherstellen</label>
            <input type="text" id="restoreUserId" placeholder="User-ID einfügen">
            <button class="btn btn-secondary mt-2" onclick="restoreAccount()"><i class="ph ph-device-mobile"></i> Gerät verbinden</button>
            <div style="font-size: 12px; color: var(--text-soft); margin-top: 6px;">Deine User-ID findest du im Haushalt-Menü unter "Account"</div>
          </div>
        </div>
      </div>
    `;
  }

  const inviteUrl = `${location.origin}?join=${s.household.invite_code}`;
  return `
    <div class="header">
      <h1><i class="ph ph-users"></i> ${s.household.name}</h1>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Einladen</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:13px; color:var(--text-soft);">Code für Mitbewohner:</span>
            <span style="font-family:monospace; font-weight:800; font-size:18px; letter-spacing:2px; background:var(--bg); padding:4px 10px; border-radius:8px; border:1px solid var(--border);">${s.household.invite_code}</span>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn btn-secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${s.household.invite_code}').then(() => app.toast('Code kopiert'))"><i class="ph ph-copy"></i> Code kopieren</button>
            <button class="btn btn-secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${inviteUrl}').then(() => app.toast('Link kopiert'))"><i class="ph ph-link"></i> Link kopieren</button>
            <button class="icon-btn" onclick="regenerateInvite()" title="Neuen Code generiert"><i class="ph ph-arrows-clockwise"></i></button>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title">Lagerorte</div>
        <button class="btn btn-small" onclick="addRootLocation()"><i class="ph ph-plus"></i> Neuer Ort</button>
      </div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch; padding:12px;">
          ${s.locations.length ? renderLocationTree(buildLocationTree(s.locations), 0) : `<div class="empty-state" style="padding:16px;">Keine Orte definiert (z. B. Küche, Kühlschrank)</div>`}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Mitglieder</div><span class="badge">${s.members.length}</span></div>
      ${s.members.map(m => `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${m.name} ${m.id === s.userId ? '(Du)' : ''}</div></div>
              <div class="card-meta">Dabei seit ${new Date(m.joined_at * 1000).toLocaleDateString('de-DE')}</div>
            </div>
          </div>
          ${(m.id !== s.userId) ? `
          <div class="card-actions">
            <button class="action-btn remove" onclick="kickMember('${m.id}', '${m.name.replace(/'/g, "\\'")}')" title="Entfernen"><i class="ph ph-sign-out"></i></button>
          </div>` : ''}
        </div>
      `).join('')}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Dein Profil</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <label>Dein Name im Haushalt</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="profileName" value="${s.userName}" style="flex:1; height:44px; padding:0 12px; font-size:16px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--field-bg); color:var(--text);">
            <button class="btn" onclick="saveProfileName()" style="width:44px; height:44px; padding:0; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><i class="ph-bold ph-check" style="font-size:18px;"></i></button>
          </div>
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border); font-size:12px; color:var(--text-soft);">
            <div style="margin-bottom:4px;"><strong>Account-Wiederherstellung:</strong></div>
            <div>Falls du das Gerät wechselst, speichere deine User-ID:</div>
            <div style="font-family:monospace; background:var(--bg); padding:4px 8px; border-radius:4px; margin-top:4px; user-select:all; border:1px solid var(--border);">${s.userId}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <button class="btn btn-danger" onclick="leaveHousehold()">Haushalt verlassen</button>
    </div>
  `;
}

export async function createHousehold() {
  const app = (window as any).app;
  const name = (document.getElementById('newHouseholdName') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast('Name erforderlich');
  try {
    const data = await app.api.households.create(name);
    localStorage.setItem('peerson_householdId', data.household.id);
    await app.loadHousehold(data.household.id);
    // BUG FIX: loadHousehold() only updates app.state -- it never calls
    // render() itself (see its definition in app.ts, used elsewhere always
    // paired with an explicit render() by its caller). Without this, the
    // UI stayed frozen on the "Haushalt erstellen" screen even though the
    // household was created and app.state.household was set correctly --
    // confirmed via a Playwright script that read window.app.state right
    // after calling createHousehold() and found the household object
    // present while the DOM still showed the old screen. The only reason
    // it ever appeared to work was the 8s background sync poll eventually
    // triggering an unrelated render.
    app.render();
    app.startSync();
  } catch (e) {
    app.toast('Fehler beim Erstellen');
  }
}

export async function joinHousehold() {
  const app = (window as any).app;
  const code = (document.getElementById('joinCode') as HTMLInputElement)?.value.trim();
  if (!code) return app.toast('Code erforderlich');
  try {
    const data = await app.api.households.join(code);
    localStorage.setItem('peerson_householdId', data.household.id);
    await app.loadHousehold(data.household.id);
    // Same missing-render bug as createHousehold() above.
    app.render();
    app.startSync();
  } catch (e) {
    app.toast('Fehler beim Beitreten');
  }
}

export async function restoreAccount() {
  const app = (window as any).app;
  const id = (document.getElementById('restoreUserId') as HTMLInputElement)?.value.trim();
  if (!id) return app.toast('Bitte User-ID eingeben');
  app.setUserId(id);
  try {
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

export async function saveProfileName() {
  const app = (window as any).app;
  const name = (document.getElementById('profileName') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast('Name erforderlich');
  await app.updateUserName(name);
}

export async function regenerateInvite() {
  const app = (window as any).app;
  try {
    const data = await app.api.households.regenerateInvite(app.state.household.id);
    app.state.household.invite_code = data.invite_code;
    app.render();
    app.toast('Neuer Code generiert');
  } catch (e) {
    app.toast('Fehler');
  }
}

export async function kickMember(userId: string, name: string) {
  const app = (window as any).app;
  if (!confirm(name + ' wirklich aus dem Haushalt entfernen?')) return;
  try {
    await app.api.households.kick(app.state.household.id, userId);
    app.state.members = app.state.members.filter((m: any) => m.id !== userId);
    app.render();
    app.toast(name + ' entfernt');
  } catch (e) {
    app.toast('Fehler beim Entfernen');
  }
}

export async function leaveHousehold() {
  const app = (window as any).app;
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

export function openLocationNameModal(title: string, initialValue: string, onSave: (name: string) => Promise<void>) {
  const app = (window as any).app;
  (window as any)._locationModalOnSave = onSave;
  app.showModal('locationNameModal', `
    <div class="modal-header"><div class="modal-title">${title}</div><button class="close-btn" onclick="window.app.closeModal('locationNameModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>Name</label><input type="text" id="locationNameInput" value="${(initialValue || '').replace(/"/g, '&quot;')}" placeholder="z. B. Küche"></div>
      <button class="btn" onclick="submitLocationNameModal()"><i class="ph-bold ph-check"></i> Speichern</button>
    </div>
  `);
}

export async function submitLocationNameModal() {
  const app = (window as any).app;
  const name = (document.getElementById('locationNameInput') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast('Name erforderlich');
  app.closeModal('locationNameModal');
  await (window as any)._locationModalOnSave(name);
}

export async function addRootLocation() {
  const app = (window as any).app;
  openLocationNameModal('Ort hinzufügen', '', async (name) => {
    try {
      const res = await app.api.locations.create({ household_id: app.state.household.id, name });
      app.state.locations.push(res.location);
      app.render();
      app.toast('Ort hinzugefügt');
    } catch (e) {
      app.toast('Fehler beim Anlegen');
    }
  });
}

export async function addChildLocation(parentId: string) {
  const app = (window as any).app;
  openLocationNameModal('Unterort hinzufügen', '', async (name) => {
    try {
      const res = await app.api.locations.create({ household_id: app.state.household.id, name, parent_id: parentId });
      app.state.locations.push(res.location);
      app.render();
      app.toast('Unterort hinzugefügt');
    } catch (e) {
      app.toast('Fehler beim Anlegen');
    }
  });
}

export async function renameLocation(id: string, currentName: string) {
  const app = (window as any).app;
  openLocationNameModal('Umbenennen', currentName, async (name) => {
    try {
      const res = await app.api.locations.update(id, { name });
      const loc = app.state.locations.find((l: any) => l.id === id);
      if (loc) loc.name = res.location.name;
      app.render();
      app.toast('Umbenannt');
    } catch (e) {
      app.toast('Fehler beim Umbenennen');
    }
  });
}

export async function deleteLocation(id: string, name: string) {
  const app = (window as any).app;
  const hasChildren = app.state.locations.some((l: any) => l.parent_id === id);
  const warning = hasChildren
    ? '"' + name + '" und alle Unterorte darin wirklich löschen? Artikel darin werden nicht gelöscht, aber verlieren ihren Ort.'
    : '"' + name + '" wirklich löschen? Artikel darin werden nicht gelöscht, aber verlieren ihren Ort.';
  if (!confirm(warning)) return;
  try {
    await app.api.locations.delete(id);
    const toRemove = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      app.state.locations.forEach((l: any) => {
        if (l.parent_id && toRemove.has(l.parent_id) && !toRemove.has(l.id)) {
          toRemove.add(l.id);
          changed = true;
        }
      });
    }
    app.state.locations = app.state.locations.filter((l: any) => !toRemove.has(l.id));
    app.state.items.forEach((i: any) => { if (i.location_id && toRemove.has(i.location_id)) i.location_id = null; });
    app.render();
    app.toast('Gelöscht');
  } catch (e) {
    app.toast('Fehler beim Löschen');
  }
}

// Attach to window so HTML onclick handlers work
Object.assign(window as any, {
  createHousehold,
  joinHousehold,
  restoreAccount,
  saveProfileName,
  regenerateInvite,
  kickMember,
  leaveHousehold,
  openLocationNameModal,
  submitLocationNameModal,
  addRootLocation,
  addChildLocation,
  renameLocation,
  deleteLocation
});
