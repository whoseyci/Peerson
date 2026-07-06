import type { App } from '../app';
import { allMemberBalances } from '../utils/finance';
import { fairnessSummary, startOfThisWeek } from '../utils/fairness';
import { colorFor, initials } from '../utils/color';
import { escapeHtml, escapeJsAttr } from '../utils/html';

export function renderPeopleView(app: App) {
  const s = app.state;
  const balances = allMemberBalances(s.members, s.expenses, s.splits);
  const totalAbs = balances.reduce((a, b) => a + Math.abs(b.balance), 0);
  const hasImbalance = balances.some(b => Math.abs(b.balance) > 0.05);
  const fairness = fairnessSummary(s.members, s.taskCompletions, startOfThisWeek());
  const fairnessById = new Map(fairness.map(f => [f.memberId, f]));
  const maxCompleted = Math.max(1, ...fairness.map(f => f.completedCount));

  return `
    <div class="header">
      <h1><i class="ph ph-users-three"></i> Leute</h1>
      <button class="icon-btn" onclick="openAddTaskModal()" title="Neue Aufgabe"><i class="ph ph-plus"></i></button>
    </div>

    <div class="balance-band">
      <div class="bb-title">Bilanz im Haushalt</div>
      ${totalAbs > 0.05 ? `
        <div class="balance-bar">
          ${balances.filter(b => Math.abs(b.balance) > 0.05).map(b => `
            <div class="seg" style="width:${(Math.abs(b.balance) / totalAbs) * 100}%; background:${colorFor(b.memberId)};"></div>
          `).join('')}
        </div>
        <div class="balance-legend">
          ${balances.filter(b => Math.abs(b.balance) > 0.05).map(b => `
            <div class="bl-item"><span class="bl-dot" style="background:${colorFor(b.memberId)};"></span>${escapeHtml(b.memberName)}</div>
          `).join('')}
        </div>
      ` : `<div style="margin-top:14px; color:var(--text-soft); font-size:13px;">Alle Konten sind ausgeglichen</div>`}
      ${hasImbalance ? `<button class="settle-cta" onclick="openSettleModal()"><i class="ph-bold ph-scales"></i> Alle Schulden ausgleichen</button>` : ''}
    </div>

    <div class="balance-band">
      <div class="bb-title">Erledigt diese Woche</div>
      ${fairness.every(f => f.completedCount === 0) ? `
        <div style="margin-top:14px; color:var(--text-soft); font-size:13px;">Diese Woche wurde noch nichts abgehakt</div>
      ` : `
        <div style="margin-top:14px; display:flex; flex-direction:column; gap:10px;">
          ${fairness.map(f => `
            <div style="display:flex; align-items:center; gap:10px;">
              <span class="pc-avatar" style="width:28px; height:28px; font-size:11px; background:${colorFor(f.memberId)}; flex-shrink:0;">${initials(f.memberName)}</span>
              <span style="font-size:13px; font-weight:700; width:72px; flex-shrink:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(f.memberName)}</span>
              <div style="flex:1; height:8px; border-radius:999px; background:var(--border); overflow:hidden;">
                <div style="height:100%; width:${(f.completedCount / maxCompleted) * 100}%; background:${colorFor(f.memberId)};"></div>
              </div>
              <span style="font-size:12.5px; font-weight:800; color:var(--text-soft); width:20px; text-align:right;">${f.completedCount}</span>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Mitglieder</div><span class="badge">${s.members.length}</span></div>
      ${balances.map(b => renderPersonCard(app, b, fairnessById.get(b.memberId))).join('')}
    </div>
  `;
}

function renderPersonCard(app: App, balance: { memberId: string; memberName: string; balance: number }, fairness: { completedCount: number } | undefined) {
  const openTaskCount = app.state.tasks.filter(t => t.status === 'todo' && t.assigned_to === balance.memberId).length;
  const isMe = balance.memberId === app.state.userId;
  const label = balance.balance > 0.05 ? 'bekommt' : balance.balance < -0.05 ? 'schuldet' : '';
  const amt = Math.abs(balance.balance);

  return `
    <div class="person-card" onclick="openPersonDetail('${escapeJsAttr(balance.memberId)}')">
      <div class="pc-avatar" style="background:${colorFor(balance.memberId)};">${initials(balance.memberName)}</div>
      <div class="pc-text">
        <div class="pc-name">${escapeHtml(balance.memberName)}${isMe ? ' (Du)' : ''}</div>
        <div class="pc-sub">
          <span class="chip"><i class="ph ph-check-circle"></i> ${openTaskCount} offen</span>
          ${fairness && fairness.completedCount > 0 ? `<span class="chip good"><i class="ph ph-fire"></i> ${fairness.completedCount} diese Woche</span>` : ''}
        </div>
      </div>
      ${label ? `
        <div class="pc-balance">
          <div class="amt" style="color:${balance.balance > 0 ? 'var(--success)' : 'var(--danger)'};">${amt.toFixed(2)} €</div>
          <div class="lbl">${label}</div>
        </div>` : ''}
    </div>`;
}


export function openPersonDetail(memberId: string) {
  const app = (window as any).app as App;
  const member = app.state.members.find(m => m.id === memberId);
  if (!member) return;
  const balances = allMemberBalances(app.state.members, app.state.expenses, app.state.splits);
  const balance = balances.find(b => b.memberId === memberId);
  const tasks = app.state.tasks.filter(t => t.assigned_to === memberId);
  const openTasks = tasks.filter(t => t.status === 'todo');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const isMe = memberId === app.state.userId;
  const weekCount = fairnessSummary(app.state.members, app.state.taskCompletions, startOfThisWeek()).find(f => f.memberId === memberId)?.completedCount || 0;
  const allTimeCount = fairnessSummary(app.state.members, app.state.taskCompletions).find(f => f.memberId === memberId)?.completedCount || 0;

  const balanceHtml = balance && Math.abs(balance.balance) > 0.05
    ? `<div style="text-align:center; margin:8px 0 18px;">
         <div style="font-size:28px; font-weight:800; color:${balance.balance > 0 ? 'var(--success)' : 'var(--danger)'};">${Math.abs(balance.balance).toFixed(2)} €</div>
         <div style="color:var(--text-soft); font-size:12.5px; font-weight:700;">${balance.balance > 0 ? 'bekommt vom Haushalt' : 'schuldet dem Haushalt'}</div>
       </div>`
    : `<div style="text-align:center; margin:8px 0 18px; color:var(--text-soft); font-size:13px;">Ausgeglichen</div>`;

  app.showModal('personDetailModal', `
    <div class="modal-header">
      <div class="modal-title" style="display:flex; align-items:center; gap:10px;">
        <span class="pc-avatar" style="width:34px; height:34px; font-size:13px; background:${colorFor(memberId)};">${initials(member.name)}</span>
        ${escapeHtml(member.name)}${isMe ? ' (Du)' : ''}
      </div>
      <button class="close-btn" onclick="window.app.closeModal('personDetailModal')"><i class="ph ph-x"></i></button>
    </div>
    <div class="modal-body">
      ${balanceHtml}
      ${!isMe && balance && Math.abs(balance.balance) > 0.05 ? `
        <button class="btn btn-secondary" style="margin-bottom:16px;" onclick="window.app.closeModal('personDetailModal'); openSettleModal();"><i class="ph ph-scales"></i> Mit ${escapeHtml(member.name)} ausgleichen</button>
      ` : ''}
      <div class="section-header"><div class="section-title">Offene Aufgaben</div><span class="badge">${openTasks.length}</span></div>
      ${openTasks.length ? openTasks.map(t => `
        <div class="card">
          <div class="card-content" onclick="window.app.closeModal('personDetailModal'); openEditTaskModal('${escapeJsAttr(t.id)}');">
            <div class="card-icon"><i class="ph ph-check-circle"></i></div>
            <div class="card-text">
              <div class="card-header"><div class="item-name">${escapeHtml(t.title)}</div></div>
              ${t.due_date ? `<div class="card-meta">${new Date(t.due_date).toLocaleDateString('de-DE')}</div>` : ''}
            </div>
          </div>
        </div>
      `).join('') : `<div class="empty-state" style="padding:16px;">Keine offenen Aufgaben</div>`}
      ${doneTasks.length ? `
        <div class="section-header" style="margin-top:16px;"><div class="section-title">Erledigt</div><span class="badge">${doneTasks.length}</span></div>
        <div style="color:var(--text-soft); font-size:13px;">${doneTasks.length} kürzlich erledigt</div>
      ` : ''}
      <div class="section-header" style="margin-top:16px;"><div class="section-title">Fairness</div></div>
      <div style="display:flex; gap:10px;">
        <div class="card" style="flex:1; padding:12px; text-align:center;">
          <div style="font-size:22px; font-weight:800;">${weekCount}</div>
          <div style="font-size:11px; color:var(--text-soft); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Diese Woche</div>
        </div>
        <div class="card" style="flex:1; padding:12px; text-align:center;">
          <div style="font-size:22px; font-weight:800;">${allTimeCount}</div>
          <div style="font-size:11px; color:var(--text-soft); font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">Insgesamt</div>
        </div>
      </div>
    </div>
  `);
}

Object.assign(window as any, {
  openPersonDetail,
});
