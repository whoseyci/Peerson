import type { App } from '../app';
import type { Location } from '../types';

// Assembles the flat locations array (as stored/returned by the API) into
// a tree for rendering. Kept as a plain array-of-nodes-with-children
// structure rather than mutating Location objects in place, so re-renders
// always rebuild from the authoritative flat app.state.locations.
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
  if (!nodes.length) {
    return depth === 0 ? '<div class="empty-state" style="padding:16px;">Noch keine Orte angelegt</div>' : '';
  }
  return nodes.map(node => `
    <div class="location-node" style="margin-left:${depth * 18}px;">
      <div class="location-row">
        <span class="location-name">${node.name}</span>
        <div class="location-row-actions">
          <button class="icon-btn-sm" title="Unterort hinzufügen" onclick="addChildLocation('${node.id}')"><i class="ph ph-plus"></i></button>
          <button class="icon-btn-sm" title="Umbenennen" onclick="renameLocation('${node.id}', '${node.name.replace(/'/g, "\\'")}')"><i class="ph ph-pencil-simple"></i></button>
          <button class="icon-btn-sm" title="Löschen" onclick="deleteLocation('${node.id}', '${node.name.replace(/'/g, "\\'")}')"><i class="ph ph-trash"></i></button>
        </div>
      </div>
      ${renderLocationTree(node.children, depth + 1)}
    </div>
  `).join('');
}

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
      <div class="section-header">
        <div class="section-title">Aufbewahrungsorte</div>
      </div>
      <div class="card">
        <div class="card-content" style="flex-direction: column; align-items: stretch; gap: 4px;">
          <div style="font-size: 12px; color: var(--text-soft); margin-bottom: 8px;">
            Räume, Möbel und Positionen zum Sortieren des Vorrats -- z. B. Küche → Rollcontainer → oben.
          </div>
          <div id="locationTree">${renderLocationTree(buildLocationTree(s.locations), 0)}</div>
          <button class="btn btn-secondary btn-small mt-2" onclick="addRootLocation()"><i class="ph ph-plus"></i> Ort hinzufügen</button>
        </div>
      </div>
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

      // --- Storage locations (nested rooms/containers/positions) ---------
      //
      // Modeled as a flat adjacency list (id + parent_id) on the backend --
      // see schema.sql for the full "why not a materialized path / nested
      // set" rationale. The UI only ever needs a name-entry modal for
      // add/rename, since the tree structure itself is expressed by which
      // button (root vs. a specific node's "+") the user clicked.

      function openLocationNameModal(title, initialValue, onSave) {
        window._locationModalOnSave = onSave;
        window.app.showModal('locationNameModal',
          '<div class="modal-header"><div class="modal-title">' + title + '</div><button class="close-btn" onclick="window.app.closeModal(\\'locationNameModal\\')"><i class="ph ph-x"></i></button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Name</label><input type="text" id="locationNameInput" value="' + (initialValue || '').replace(/"/g, '&quot;') + '" placeholder="z. B. Küche"></div>' +
            '<button class="btn" onclick="submitLocationNameModal()"><i class="ph-bold ph-check"></i></button>' +
          '</div>'
        );
      }

      async function submitLocationNameModal() {
        const name = document.getElementById('locationNameInput').value.trim();
        if (!name) return app.toast('Name erforderlich');
        window.app.closeModal('locationNameModal');
        await window._locationModalOnSave(name);
      }

      async function addRootLocation() {
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

      async function addChildLocation(parentId) {
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

      async function renameLocation(id, currentName) {
        openLocationNameModal('Umbenennen', currentName, async (name) => {
          try {
            const res = await app.api.locations.update(id, { name });
            const loc = app.state.locations.find(l => l.id === id);
            if (loc) loc.name = res.location.name;
            app.render();
            app.toast('Umbenannt');
          } catch (e) {
            app.toast('Fehler beim Umbenennen');
          }
        });
      }

      async function deleteLocation(id, name) {
        // Deleting a location cascades to its own descendants on the
        // backend (ON DELETE CASCADE) and un-assigns (not deletes) any
        // items that pointed at it or a descendant (ON DELETE SET NULL) --
        // worth naming both consequences explicitly since this action is
        // not reversible via the soft-delete/undo system the rest of the
        // app uses for items/tasks/etc.
        const hasChildren = app.state.locations.some(l => l.parent_id === id);
        const warning = hasChildren
          ? '"' + name + '" und alle Unterorte darin wirklich löschen? Artikel darin werden nicht gelöscht, aber verlieren ihren Ort.'
          : '"' + name + '" wirklich löschen? Artikel darin werden nicht gelöscht, aber verlieren ihren Ort.';
        if (!confirm(warning)) return;
        try {
          await app.api.locations.delete(id);
          const toRemove = new Set([id]);
          // Mirror the backend's cascade client-side so the tree updates
          // immediately without waiting for the next sync poll.
          let changed = true;
          while (changed) {
            changed = false;
            app.state.locations.forEach(l => {
              if (l.parent_id && toRemove.has(l.parent_id) && !toRemove.has(l.id)) {
                toRemove.add(l.id);
                changed = true;
              }
            });
          }
          app.state.locations = app.state.locations.filter(l => !toRemove.has(l.id));
          app.state.items.forEach(i => { if (i.location_id && toRemove.has(i.location_id)) i.location_id = null; });
          app.render();
          app.toast('Gelöscht');
        } catch (e) {
          app.toast('Fehler beim Löschen');
        }
      }
    </script>
  `;
}
