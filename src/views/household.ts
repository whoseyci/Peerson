import type { App } from '../app';
import type { Location } from '../types';
import { escapeAttr, escapeHtml, escapeJsAttr } from '../utils/html';
import { t, getLanguage } from '../i18n';

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
            <button class="icon-btn btn-mini" onclick="addChildLocation('${id}')" title="${t('hh.addSubLocation')}" aria-label="${t('hh.addSubLocation')}"><i class="ph ph-plus"></i></button>
            <button class="icon-btn btn-mini" onclick="renameLocation('${id}', '${jsName}')" title="${t('hh.rename')}" aria-label="${name} ${t('hh.rename').toLowerCase()}"><i class="ph ph-pencil-simple"></i></button>
            <button class="icon-btn btn-mini" onclick="deleteLocation('${id}', '${jsName}')" title="${t('hh.delete')}" aria-label="${name} ${t('hh.delete').toLowerCase()}"><i class="ph ph-trash"></i></button>
          </span>
        </div>
        ${renderLocationTree(node.children, depth + 1)}
      `;
    }).join('');
}

function formatJoinedAt(joinedAt: unknown): string {
  const seconds = typeof joinedAt === 'number' ? joinedAt : Number(joinedAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return '—';
  return t('hh.joinedSince', { date: date.toLocaleDateString() });
}

export function renderHouseholdView(app: App) {
  const s = app.state;

  if (!s.householdId || !s.household) {
    return `
      <div class="welcome-hero">
        <div class="welcome-mark"><i class="ph ph-house-heart"></i></div>
        <h1>Peerson</h1>
        <p>${t('hh.welcomeTagline')}</p>
      </div>

      <div class="section">
        <div class="quick-grid">
          <div class="quick-card"><i class="ph ph-package"></i><span>${t('hh.featureStock')}</span></div>
          <div class="quick-card"><i class="ph ph-shopping-cart-simple"></i><span>${t('hh.featureShopping')}</span></div>
          <div class="quick-card"><i class="ph ph-check-circle"></i><span>${t('hh.featureTasks')}</span></div>
          <div class="quick-card"><i class="ph ph-currency-eur"></i><span>${t('hh.featureFinances')}</span></div>
        </div>
      </div>

      <div class="section">
        <div class="card">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>${t('hh.createLabel')}</label>
            <input type="text" id="newHouseholdName" placeholder="${t('hh.createPlaceholder')}" autocomplete="organization">
            <button class="btn mt-2" onclick="createHousehold()"><i class="ph-bold ph-plus"></i> ${t('hh.createButton')}</button>
          </div>
        </div>
        <div class="card mt-3">
          <div class="card-content" style="flex-direction:column; align-items:stretch;">
            <label>${t('hh.joinLabel')}</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="text" id="joinCode" placeholder="${t('hh.joinPlaceholder')}" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="join" style="flex:1; min-width:0;">
              <button class="btn btn-secondary btn-small" style="width:auto; margin-top:0; flex-shrink:0;" onclick="pasteIntoField('joinCode', 'code')"><i class="ph ph-clipboard-text"></i> ${t('hh.paste')}</button>
            </div>
            <button class="btn btn-secondary mt-2" onclick="joinHousehold()"><i class="ph-bold ph-sign-in"></i> ${t('hh.joinButton')}</button>
          </div>
        </div>
        <details class="restore-details mt-3">
          <summary>${t('hh.restoreTitle')}</summary>
          <div class="card mt-2">
            <div class="card-content" style="flex-direction:column; align-items:stretch;">
              <label>${t('hh.restoreUserId')}</label>
              <div style="display:flex; gap:8px; align-items:center;">
                <input type="text" id="restoreUserId" placeholder="${t('hh.restorePlaceholder')}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" style="flex:1; min-width:0;">
                <button class="btn btn-secondary btn-small" style="width:auto; margin-top:0; flex-shrink:0;" onclick="pasteIntoField('restoreUserId', 'uuid')"><i class="ph ph-clipboard-text"></i> ${t('hh.paste')}</button>
              </div>
              <button class="btn btn-secondary mt-2" onclick="restoreAccount()"><i class="ph ph-device-mobile"></i> ${t('hh.restoreButton')}</button>
              <div style="font-size: 12px; color: var(--text-soft); margin-top: 6px;">${t('hh.restoreHint')}</div>
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
      <div class="section-header"><div class="section-title">${t('hh.invite')}</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:13px; color:var(--text-soft);">${t('hh.inviteCodeLabel')}</span>
            <span style="font-family:monospace; font-weight:800; font-size:18px; letter-spacing:2px; background:var(--bg); padding:4px 10px; border-radius:8px; border:1px solid var(--border);">${inviteCode}</span>
          </div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn btn-secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${inviteCodeJs}').then(() => app.toast('${t('hh.codeCopied')}'))"><i class="ph ph-copy"></i> ${t('hh.copyCode')}</button>
            <button class="btn btn-secondary" style="flex:1;" onclick="navigator.clipboard.writeText('${inviteUrlJs}').then(() => app.toast('${t('hh.linkCopied')}'))"><i class="ph ph-link"></i> ${t('hh.copyLink')}</button>
            <button class="icon-btn" onclick="regenerateInvite()" title="${t('hh.newCodeGenerated')}"><i class="ph ph-arrows-clockwise"></i></button>
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title">${t('hh.locations')}</div>
        <button class="btn btn-small" onclick="addRootLocation()"><i class="ph ph-plus"></i> ${t('hh.newLocation')}</button>
      </div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch; padding:12px;">
          ${s.locations.length ? renderLocationTree(buildLocationTree(s.locations), 0) : `<div class="empty-state" style="padding:16px;">${t('hh.noLocations')}</div>`}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">${t('hh.members')}</div><span class="badge">${s.members.length}</span></div>
      ${s.members.map(m => {
        const memberName = escapeHtml(m.name);
        const memberNameJs = escapeJsAttr(m.name);
        const memberId = escapeJsAttr(m.id);
        return `
        <div class="card">
          <div class="card-content">
            <div class="card-icon"><i class="ph ph-user"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${memberName} ${m.id === s.userId ? t('hh.you') : ''}</div></div>
              <div class="card-meta">${formatJoinedAt(m.joined_at)}</div>
            </div>
          </div>
          ${(m.id !== s.userId) ? `
          <div class="card-actions">
            <button class="action-btn remove" onclick="kickMember('${memberId}', '${memberNameJs}')" title="${t('hh.removeMember')}" aria-label="${memberName} ${t('hh.removeMember').toLowerCase()}"><i class="ph ph-sign-out"></i></button>
          </div>` : ''}
        </div>
      `}).join('')}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">${t('hh.profile')}</div></div>
      <div class="card">
        <div class="card-content" style="flex-direction:column; align-items:stretch;">
          <label>${t('hh.profileName')}</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="profileName" value="${escapeAttr(s.userName)}" style="flex:1; height:44px; padding:0 12px; font-size:16px; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--field-bg); color:var(--text);">
            <button class="btn" onclick="saveProfileName()" style="width:44px; height:44px; padding:0; display:flex; align-items:center; justify-content:center; flex-shrink:0;"><i class="ph-bold ph-check" style="font-size:18px;"></i></button>
          </div>
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border); font-size:12px; color:var(--text-soft);">
            <div style="margin-bottom:4px;"><strong>${t('hh.accountRecovery')}</strong></div>
            <div>${t('hh.saveUserId')}</div>
            <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
              <div style="font-family:monospace; background:var(--bg); padding:7px 8px; border-radius:8px; user-select:all; border:1px solid var(--border); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(s.userId)}</div>
              <button class="btn btn-secondary btn-small" style="width:auto; margin-top:0; flex-shrink:0;" onclick="copyUserId('${escapeJsAttr(s.userId)}')"><i class="ph ph-copy"></i> ${t('hh.copyUserId')}</button>
            </div>
          </div>
          <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border);">
            <label>${t('settings.language')}</label>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <button class="btn btn-small ${getLanguage() === 'de' ? '' : 'btn-secondary'}" onclick="setAppLanguage('de')" style="flex:1;">${t('settings.lang.de')}</button>
              <button class="btn btn-small ${getLanguage() === 'en' ? '' : 'btn-secondary'}" onclick="setAppLanguage('en')" style="flex:1;">${t('settings.lang.en')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="section" style="display:flex; flex-direction:column; gap:12px;">
      <button class="btn btn-secondary" onclick="exportHouseholdData()"><i class="ph ph-download-simple"></i> ${t('hh.exportData')}</button>
      <button class="btn btn-danger" onclick="leaveHousehold()">${t('hh.leaveHousehold')}</button>
      <button class="btn btn-danger" onclick="deleteAccount()" style="border-color:#dc2626; color:#dc2626;">${t('hh.deleteAccount')}</button>
    </div>
  `;
}

export async function createHousehold() {
  const app = (window as any).app;
  const name = (document.getElementById('newHouseholdName') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast(t('app.nameRequired'));
  try {
    const data = await app.api.households.create(name);
    localStorage.setItem('peerson_householdId', data.household.id);
    await app.loadHousehold(data.household.id);
    app.navigate('home');
    app.startSync();
  } catch (e) {
    app.toast(t('app.householdCreateError'));
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
      app.toast(t('hh.clipboardEmpty'));
      input.focus();
      return;
    }
    input.value = value;
    input.focus();
    app.toast(t('hh.inserted'));
  } catch (e) {
    input.focus();
    input.select();
    app.toast(t('hh.insertNotAllowed'));
  }
}

export async function joinHousehold() {
  const app = (window as any).app;
  const code = normalizeJoinCode((document.getElementById('joinCode') as HTMLInputElement)?.value || '');
  if (!code) return app.toast(t('hh.codeRequired'));
  try {
    const data = await app.api.households.join(code);
    localStorage.setItem('peerson_householdId', data.household.id);
    await app.loadHousehold(data.household.id);
    app.navigate('home');
    app.startSync();
  } catch (e) {
    app.toast(t('app.householdCreateError'));
  }
}

export async function copyUserId(id: string) {
  const app = (window as any).app;
  try {
    await navigator.clipboard.writeText(id);
    app.toast(t('hh.userIdCopied'));
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
      app.toast(t('hh.userIdCopied'));
    } catch {
      app.toast(t('hh.copyFailed'));
    } finally {
      fallback.remove();
    }
  }
}

export async function restoreAccount() {
  const app = (window as any).app;
  const id = normalizeUuid((document.getElementById('restoreUserId') as HTMLInputElement)?.value || '');
  if (!id) return app.toast(t('hh.enterUserId'));
  app.setUserId(id);
  try {
    const data = await app.api.households.list();
    if (data.households && data.households.length > 0) {
      const household = data.households[0];
      localStorage.setItem('peerson_householdId', household.id);
      app.toast(t('hh.accountRestored'));
    } else {
      app.toast(t('hh.accountRestoredNoHousehold'));
    }
  } catch (e) {
    app.toast(t('hh.accountRestoredReload'));
  }
  setTimeout(() => location.reload(), 1200);
}

export async function saveProfileName() {
  const app = (window as any).app;
  const name = (document.getElementById('profileName') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast(t('app.nameRequired'));
  await app.updateUserName(name);
}

export async function regenerateInvite() {
  const app = (window as any).app;
  try {
    const data = await app.api.households.regenerateInvite(app.state.household.id);
    app.state.household.invite_code = data.invite_code;
    app.render();
    app.toast(t('hh.newCodeGenerated'));
  } catch (e) {
    app.toast(t('hh.error'));
  }
}

export async function kickMember(userId: string, name: string) {
  const app = (window as any).app;
  if (!confirm(t('hh.confirmRemove', { name }))) return;
  try {
    await app.api.households.kick(app.state.household.id, userId);
    app.state.members = app.state.members.filter((m: any) => m.id !== userId);
    app.render();
    app.toast(t('hh.memberRemoved', { name }));
  } catch (e) {
    app.toast(t('hh.memberRemoveError'));
  }
}

export async function leaveHousehold() {
  const app = (window as any).app;
  if (!confirm(t('hh.confirmLeave'))) return;
  try {
    await app.api.households.leave(app.state.household.id, app.state.userId);
  } catch (e) {}
  localStorage.removeItem('peerson_householdId');
  app.state.householdId = null;
  app.state.household = null;
  app.navigate('household');
  app.render();
}

export async function exportHouseholdData() {
  const app = (window as any).app;
  if (!app.state.household?.id) return;
  try {
    app.toast('Daten werden exportiert...');
    const data = await app.api.export.get(app.state.household.id);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `peerson-export-${app.state.household.name || 'haushalt'}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    app.toast('Export erfolgreich');
  } catch (e) {
    app.toast('Fehler beim Exportieren');
  }
}

export async function deleteAccount() {
  const app = (window as any).app;
  if (!confirm('Konto wirklich löschen? Dies entfernt deinen Zugang aus allen Haushalten und ist unwiderruflich.')) return;
  try {
    await app.api.users.deleteAccount();
  } catch (e) {
    app.toast('Fehler beim Löschen des Kontos');
    return;
  }
  const knownKeys = [
    'peerson_userId',
    'peerson_userName',
    'peerson_householdId',
    'peerson_view',
    'peerson_darkMode',
    'peerson_scanMode',
  ];
  knownKeys.forEach(k => localStorage.removeItem(k));
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith('peerson_')) {
      localStorage.removeItem(key);
    }
  }
  app.state.userId = null;
  app.state.userName = null;
  app.state.householdId = null;
  app.state.household = null;
  app.state.members = [];
  location.reload();
}

export function openLocationNameModal(title: string, initialValue: string, onSave: (name: string) => Promise<void>) {
  const app = (window as any).app;
  (window as any)._locationModalOnSave = onSave;
  app.showModal('locationNameModal', `
    <div class="modal-header"><div class="modal-title">${escapeHtml(title)}</div><button class="close-btn" onclick="window.app.closeModal('locationNameModal')"><i class="ph ph-x"></i></button></div>
    <div class="modal-body">
      <div class="form-group"><label>${t('rooms.name')}</label><input type="text" id="locationNameInput" value="${escapeAttr(initialValue || '')}" placeholder="${t('rooms.placeRoom')}"></div>
      <button class="btn" onclick="submitLocationNameModal()"><i class="ph-bold ph-check"></i> ${t('action.save')}</button>
    </div>
  `);
}

export async function submitLocationNameModal() {
  const app = (window as any).app;
  const name = (document.getElementById('locationNameInput') as HTMLInputElement)?.value.trim();
  if (!name) return app.toast(t('app.nameRequired'));
  app.closeModal('locationNameModal');
  await (window as any)._locationModalOnSave(name);
}

export async function addRootLocation() {
  const app = (window as any).app;
  openLocationNameModal(t('hh.locationAddTitle'), '', async (name) => {
    try {
      const res = await app.api.locations.create({ household_id: app.state.household.id, name });
      app.state.locations.push(res.location);
      app.render();
      app.toast(t('hh.locationAdded'));
    } catch (e) {
      app.toast(t('hh.locationAddError'));
    }
  });
}

export async function addChildLocation(parentId: string) {
  const app = (window as any).app;
  openLocationNameModal(t('hh.subLocationAddTitle'), '', async (name) => {
    try {
      const res = await app.api.locations.create({ household_id: app.state.household.id, name, parent_id: parentId });
      app.state.locations.push(res.location);
      app.render();
      app.toast(t('hh.subLocationAdded'));
    } catch (e) {
      app.toast(t('hh.locationAddError'));
    }
  });
}

export async function renameLocation(id: string, currentName: string) {
  const app = (window as any).app;
  openLocationNameModal(t('hh.locationRenameTitle'), currentName, async (name) => {
    try {
      const res = await app.api.locations.update(id, { name });
      const loc = app.state.locations.find((l: any) => l.id === id);
      if (loc) loc.name = res.location.name;
      app.render();
      app.toast(t('hh.locationRenamed'));
    } catch (e) {
      app.toast(t('hh.locationRenameError'));
    }
  });
}

export async function deleteLocation(id: string, name: string) {
  const app = (window as any).app;
  const hasChildren = app.state.locations.some((l: any) => l.parent_id === id);
  const warning = hasChildren
    ? t('hh.locationDeleteWithChildren', { name })
    : t('hh.locationDelete', { name });
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
    app.toast(t('hh.locationDeleted'));
  } catch (e) {
    app.toast(t('hh.locationDeleteError'));
  }
}

// Attach to window so HTML onclick handlers work
if (typeof window !== 'undefined') {
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
    exportHouseholdData,
    deleteAccount,
    openLocationNameModal,
    submitLocationNameModal,
    addRootLocation,
    addChildLocation,
    renameLocation,
    deleteLocation
  });
}
