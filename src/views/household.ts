import type { App } from '../app';
import type { Location } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';

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
      const id = escapeJsAttr(node.id);
      const name = escapeHtml(node.name);
      const jsName = escapeJsAttr(node.name);
      return `
        <div class="location-tree-row" style="padding-left: ${indent}px;">
          <span class="location-name"><i class="ph ph-folder"></i> ${name}</span>
          <span class="location-actions">
            <button class="icon-btn btn-mini" onclick="addChildLocation('${id}')" title="Unterort hinzufügen" aria-label="Unterort hinzufügen"><i class="ph ph-plus"></i></button>
            <button class="icon-btn btn-mini" onclick="renameLocation('${id}', '${jsName}')" title="Umbenennen" aria-label="${name} umbenennen"><i class="ph ph-pencil-simple"></i></button>
            <button class="icon-btn btn-mini" onclick="deleteLocation('${id}', '${jsName}')" title="Löschen" aria-label="${name} löschen"><i class="ph ph-trash"></i></button>
          </span>
        </div>
        ${renderLocationTree(node.children, depth + 1)}
      `;
    }).join('');
}

function formatJoinedAt(joinedAt: unknown): string {
  const seconds = typeof joinedAt === 'number' ? joinedAt : Number(joinedAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'unbekannt';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? 'unbekannt' : date.toLocaleDateString('de-DE');
}

export function renderHouseholdView(app: App) {
  const s = app.state;

  if (!s.householdId || !s.household) {
    return `
      <div class="welcome-hero">
        <div class="welcome-mark"><i class="ph ph-house-heart"></i></div>
        <h1>Peerson</h1>
        <p>Dein Haushalt, endlich synchron: Vorrat, Einkauf, Aufgaben und Finanzen an einem Ort.</p>
      </div>

      <div class="section">
        <div class="quick-grid">
          <div class="quick-card"><i class="ph ph-package"></i><span>Vorrat tracken</span></div>
          <div class="quick-card"><i class="ph ph-shopping-cart-simple"></i><span>Einkäufe planen</span></div>
          <div class="quick-card"><i class="ph ph-check-circle"></i><span>Aufgaben teilen</span></div>
          <div class="quick-card"><i class="ph ph-currency-eur"></i><span>Kosten splitten</span></div>
        </div>
      </div>

      <div class="section">
        <div class="card">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>Haushalt erstellen</label>
            <input type="text" id="newHouseholdName" placeholder="Name (z. B. WG Mitte)" autocomplete="organization">
            <button class="btn mt-2" onclick="createHousehold()"><i class="ph-bold ph-plus"></i> Neuen Haushalt starten</button>
          </div>
        </div>
        <div class="card mt-3">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>Mit Code beitreten</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="text" id="joinCode" placeholder="8-stelliger Code" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="join" style="flex:1; min-width:0;">
              <button class="btn btn-secondary btn-small" style="width:auto; margin-top:0; flex-shrink:0;" onclick="pasteIntoField('joinCode', 'code')"><i class="ph ph-clipboard-text"></i> Einfügen</button>
            </div>
            <button class="btn btn-secondary mt-2" onclick="joinHousehold()"><i class="ph-bold ph-sign-in"></i> Haushalt beitreten</button>
          </div>
        </div>
        <details class="restore-details mt-3">
          <summary>Account von anderem Gerät wiederherstellen</summary>
          <div class="card mt-2">
            <div class="card-content" style="flex-direction:column; align-items:stretch;">
              <label>User-ID</label>
              <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="restoreUserId" placeholder="User-ID einfügen" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="flex:1; min-width:0;">
                <button class="btn btn-secondary btn-small" style="width:auto; margin-top:0; flex-shrink:0;" onclick="pasteIntoField('restoreUserId', 'uuid')"><i class="ph ph-clipboard-text"></i> Einfügen</button>
              </div>
              <button class="btn btn-secondary mt-2" onclick="restoreAccount()"><i class="ph ph-device-mobile"></i> Gerät verbinden</button>
              <div style="font-size: 12px; color: var(--text-soft); margin-top: 6px;">Deine User-ID findest du im Haushalt-Menü unter „Account“.</div>
            </div>
          </div>
        </details>
      </div>
    `;
  }

  const inviteUrl = `${location.origin}?join=${s.household.invite_code}`;
  const householdName = escapeHtml(s.household.name);
  const inviteCode = escapeHtml(s.household.invite_code);
  const inviteCodeJs = escapeJsAttr(s.household.invite_code);
  const inviteUrlJs = escapeJsAttr(inviteUrl);
  return `
    <div class="header">
      <h1><i class="ph ph-users"></i> ${householdName}</h1>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Einladen</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:13px; color:var(--text-soft);">Code für Mitbewohner:</span>
            <span style="font-family:monospace; font-weight:800; font-size:18px; letter-spacing:2px; background:var(--bg); padding:4px 10px; border-radius:8px; border:1px solid var(--border);">${inviteCode}</span>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn btn-secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${inviteCodeJs}').then(() => app.toast('Code kopiert'))"><i class="ph ph-copy"></i> Code kopieren</button>
            <button class="btn btn-secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${inviteUrlJs}').then(() => app.toast('Link kopiert'))"><i class="ph ph-link"></i> Link kopieren</button>
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
      ${s.members.map(m => {
        const memberName = escapeHtml(m.name);
        const memberNameJs = escapeJsAttr(m.name);
        const memberId = escapeJsAttr(m.id);
        return `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${memberName} ${m.id === s.userId ? '(Du)' : ''}</div></div>
              <div class="card-meta">Dabei seit ${formatJoinedAt(m.joined_at)}</div>
            </div>
          </div>
          ${(m.id !== s.userId) ? `
          <div class="card-actions">
            <button class="action-btn remove" onclick="kickMember('${memberId}', '${memberNameJs}')" title="Entfernen" aria-label="${memberName} entfernen"><i class="ph ph-sign-out"></i></button>
          </div>` : ''}
        </div>
      `}).join('')}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Dein Profil</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <label>Dein Name im Haushalt</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="profileName" value="${escapeAttr(s.userName)}" style="flex:1; height:44px; padding:0 12px; font-size:16px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--field-bg); color:var(--text);">
            <button class="btn" onclick="saveProfileName()" style="width:44px; height:44px; padding:0; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><i class="ph-bold ph-check" style="font-size:18px;"></i></button>
          </div>
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border); font-size:12px; color:var(--text-soft);">
            <div style="margin-bottom:4px;"><strong>Account-Wiederherstellung:</strong></div>
            <div>Falls du das Gerät wechselst, speichere deine User-ID:</div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
              <div style="font-family:monospace; background:var(--bg); padding:7px 8px; border-radius:8px; user-select:all; border:1px solid var(--border); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(s.userId)}</div>
              <button class="btn btn-secondary btn-small" style="width:auto; margin-top:0; flex-shrink:0;" onclick="copyUserId('${escapeJsAttr(s.userId)}')"><i class="ph ph-copy"></i> Kopieren</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Klassische Ansicht</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <div style="font-size:13px; color:var(--text-soft); margin-bottom:12px;">
            Die dichteren Power-User-Ansichten (Kategorien, Preise, Nährwerte, Wiederholungen, Aufteilungsregeln, Zahlungshistorie) sind weiterhin verfügbar:
          </div>
          <div class="quick-grid">
            <button class="quick-card" onclick="app.navigate('inventory')" style="cursor:pointer; text-align:left; border:1px solid var(--border);"><i class="ph ph-package"></i><span>Vorrat</span></button>
            <button class="quick-card" onclick="app.navigate('shopping')" style="cursor:pointer; text-align:left; border:1px solid var(--border);"><i class="ph ph-shopping-cart-simple"></i><span>Einkaufen</span></button>
            <button class="quick-card" onclick="app.navigate('tasks')" style="cursor:pointer; text-align:left; border:1px solid var(--border);"><i class="ph ph-check-circle"></i><span>Aufgaben</span></button>
            <button class="quick-card" onclick="app.navigate('expenses')" style="cursor:pointer; text-align:left; border:1px solid var(--border);"><i class="ph ph-currency-eur"></i><span>Finanzen</span></button>
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
    app.navigate('home');
    app.startSync();
  } catch (e) {
    app.toast('Fehler beim Erstellen');
  }
}

function normalizeJoinCode(raw: string) {
  return raw.replace(/[\s-]+/g, '').trim().toUpperCase();
}

function normalizeUuid(raw: string) {
  return raw.trim();
}

export async function pasteIntoField(fieldId: string, mode: 'code' | 'uuid' = 'uuid') {
  const app = (window as any).app;
  const input = document.getElementById(fieldId) as HTMLInputElement | null;
  if (!input) return;

  try {
    const text = await navigator.clipboard.readText();
    const value = mode === 'code' ? normalizeJoinCode(text) : normalizeUuid(text);
    if (!value) {
      app.toast('Zwischenablage ist leer');
      input.focus();
      return;
    }
    input.value = value;
    input.focus();
    app.toast('Eingefügt');
  } catch (e) {
    input.focus();
    input.select();
    app.toast('Einfügen nicht erlaubt — bitte Feld lange antippen und einfügen');
  }
}

export async function joinHousehold() {
  const app = (window as any).app;
  const code = normalizeJoinCode((document.getElementById('joinCode') as HTMLInputElement)?.value || '');
  if (!code) return app.toast('Code erforderlich');
  try {
    const data = await app.api.households.join(code);
    localStorage.setItem('peerson_householdId', data.household.id);
    await app.loadHousehold(data.household.id);
    // Same missing-render bug as createHousehold() above.
    app.navigate('home');
    app.startSync();
  } catch (e) {
    app.toast('Fehler beim Beitreten');
  }
}

export async function copyUserId(id: string) {
  const app = (window as any).app;
  try {
    await navigator.clipboard.writeText(id);
    app.toast('User-ID kopiert');
  } catch (e) {
    const fallback = document.createElement('textarea');
    fallback.value = id;
    fallback.setAttribute('readonly', 'true');
    fallback.style.position = 'fixed';
    fallback.style.left = '-9999px';
    document.body.appendChild(fallback);
    fallback.select();
    try {
      document.execCommand('copy');
      app.toast('User-ID kopiert');
    } catch {
      app.toast('Kopieren fehlgeschlagen — User-ID antippen und manuell kopieren');
    } finally {
      fallback.remove();
    }
  }
}

export async function restoreAccount() {
  const app = (window as any).app;
  const id = normalizeUuid((document.getElementById('restoreUserId') as HTMLInputElement)?.value || '');
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
    <div class="modal-header"><div class="modal-title">${escapeHtml(title)}</div><button class="close-btn" onclick="window.app.closeModal('locationNameModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>Name</label><input type="text" id="locationNameInput" value="${escapeAttr(initialValue || '')}" placeholder="z. B. Küche"></div>
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
  pasteIntoField,
  copyUserId,
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
