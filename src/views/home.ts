import type { App } from '../app';
import { computeFeed, getSnoozedKeys, snoozeKey, type FeedItem } from '../utils/feed';
import { escapeHtml } from '../utils/html';
import { renderBudgetsSection } from './expenses';
import { t } from '../i18n';

const STACK_SIZE = 3;

function feedItemIcon(f: FeedItem): string {
  if (f.kind === 'task') return 'check-circle';
  if (f.kind === 'balance') return f.icon;
  return f.icon;
}

function actionLabel(f: FeedItem): string {
  switch (f.kind) {
    case 'expiring': return t('feed.action.expiring');
    case 'lowstock':
    case 'predicted-low': return t('feed.action.lowstock');
    case 'task': return t('feed.action.task');
    case 'balance': return t('feed.action.balance');
    case 'budget': return t('feed.action.budget');
  }
}

export function renderHomeView(app: App) {
  const s = app.state;
  const snoozed = getSnoozedKeys(s.householdId);
  const feed = computeFeed(s, snoozed);
  const stack = feed.slice(0, STACK_SIZE);
  const overflow = feed.slice(STACK_SIZE);

  const hour = new Date().getHours();
  const greet = hour < 5 ? t('home.greet.night') : hour < 11 ? t('home.greet.morning') : hour < 18 ? t('home.greet.afternoon') : t('home.greet.evening');
  const alertCount = feed.length;
  const headline = alertCount === 0
    ? t('home.headline.ok')
    : alertCount === 1
      ? t('home.headline.one')
      : t('home.headline.n', { count: alertCount });
  const sub = alertCount === 0
    ? t('home.sub.ok')
    : t('home.sub.n');

  return `
    <div class="home-hero">
      <i class="ph ph-sparkle"></i>
      <div class="brief-kicker">${greet}${s.userName ? ', ' + escapeHtml(s.userName) : ''}</div>
      <h2>${headline}</h2>
      <p>${sub}</p>
    </div>

    <div id="stackWrap" data-stack-index="0">
      ${renderStack(app, stack)}
    </div>
    ${stack.length ? `<div class="swipe-progress">${stack.map((_, i) => `<span class="${i === 0 ? '' : ''}" data-dot="${i}"></span>`).join('')}</div>` : ''}

    <div class="quick-row">
      <button class="quick-tile" onclick="openShoppingTrip()"><span class="qt-icon"><i class="ph ph-shopping-cart-simple"></i></span>${t('home.tourStart')}</button>
      <button class="quick-tile" onclick="startScanFlow()"><span class="qt-icon"><i class="ph ph-barcode"></i></span>${t('home.scan')}</button>
      <button class="quick-tile" onclick="openAddTaskModal()"><span class="qt-icon"><i class="ph ph-check-circle"></i></span>${t('home.task')}</button>
      <button class="quick-tile" onclick="openAddExpenseModal()"><span class="qt-icon"><i class="ph ph-currency-eur"></i></span>${t('home.expense')}</button>
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">Aufgaben</div></div>
      <button class="add-row-dashed" onclick="window.app.navigate('tasks')"><i class="ph ph-list-checks"></i> Alle Aufgaben ansehen</button>
    </div>

    ${renderBudgetsSection(app)}

    ${overflow.length ? `
    <div class="section">
      <div class="section-header"><div class="section-title">${t('home.overflow')}</div><span class="badge">${overflow.length}</span></div>
      ${overflow.map(f => renderOverflowRow(f)).join('')}
    </div>` : ''}
  `;
}

function renderStack(app: App, stack: FeedItem[]) {
  if (!stack.length) {
    return `
      <div class="stack-empty">
        <i class="ph ph-check-circle"></i>
        <span>${t('home.stackEmpty')}</span>
      </div>`;
  }
  return `
    <div class="stack-wrap">
      ${stack.map((f, i) => `
        <div class="swipe-card" data-feed-key="${escapeHtml(f.key)}" data-stack-pos="${i}" style="z-index:${stack.length - i}; ${i > 0 ? `transform: scale(${1 - i * 0.04}) translateY(${i * 10}px); opacity:${1 - i * 0.25};` : ''}">
          <div class="stack-hint left"><i class="ph-bold ph-clock"></i>&nbsp;${t('home.swipeLater')}</div>
          <div class="stack-hint right"><i class="ph-bold ph-check"></i>&nbsp;${t('home.swipeDone')}</div>
          <div class="sc-top">
            <div class="sc-icon"><i class="ph ph-${escapeHtml(feedItemIcon(f))}"></i></div>
            <div>
              <div class="sc-title">${escapeHtml(f.title)}</div>
              <div class="sc-sub">${escapeHtml(f.sub)}</div>
            </div>
          </div>
          <div class="sc-actions">
            <button class="sc-btn snooze" onclick="snoozeFeedItem('${escapeHtml(f.key)}')"><i class="ph ph-clock"></i> ${t('home.swipeLater')}</button>
            <button class="sc-btn act" onclick="actOnFeedItem('${escapeHtml(f.key)}')"><i class="ph ph-check"></i> ${escapeHtml(actionLabel(f))}</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderOverflowRow(f: FeedItem) {
  return `
    <div class="card feed-overflow-item">
      <div class="card-content">
        <div class="card-icon"><i class="ph ph-${escapeHtml(feedItemIcon(f))}"></i></div>
        <div class="card-text">
          <div class="card-header"><div class="item-name">${escapeHtml(f.title)}</div></div>
          <div class="card-meta">${escapeHtml(f.sub)}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="action-btn" onclick="actOnFeedItem('${escapeHtml(f.key)}')" title="${escapeHtml(actionLabel(f))}"><i class="ph ph-check"></i></button>
      </div>
    </div>`;
}

function findFeedItem(app: App, key: string): FeedItem | undefined {
  const snoozed = getSnoozedKeys(app.state.householdId);
  return computeFeed(app.state, snoozed).find(f => f.key === key);
}

export function snoozeFeedItem(key: string) {
  const app = (window as any).app as App;
  snoozeKey(app.state.householdId, key);
  animateStackCardOut(key, 'left', () => app.render());
}

export async function actOnFeedItem(key: string) {
  const app = (window as any).app as App;
  const item = findFeedItem(app, key);
  if (!item) { app.render(); return; }

  animateStackCardOut(key, 'right', async () => {
    switch (item.kind) {
      case 'expiring':
        await (window as any).removeOne(item.refId);
        break;
      case 'lowstock':
      case 'predicted-low': {
        const total = app.state.batches.filter(b => b.item_id === item.refId).reduce((a, b) => a + b.quantity, 0);
        const pantryItem = app.state.items.find(i => i.id === item.refId);
        const needed = pantryItem ? Math.max(1, pantryItem.threshold - total) : 1;
        await (window as any).autoAddShopping(item.refId, needed);
        break;
      }
      case 'task':
        await (window as any).toggleTask(item.refId);
        break;
      case 'balance':
        (window as any).openSettleModal();
        break;
      case 'budget':
        // Nothing to "resolve" here the way a low-stock item or an
        // overdue task can be -- take the user straight to Finanzen so
        // they can see (and if they want, adjust) the budget that's
        // being projected to run over.
        app.navigate('expenses');
        break;
    }
    app.render();
  });
}

function animateStackCardOut(key: string, direction: 'left' | 'right', done: () => void) {
  const card = document.querySelector(`.swipe-card[data-feed-key="${CSS.escape(key)}"]`) as HTMLElement | null;
  if (!card) { done(); return; }
  card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
  card.style.transform = `translateX(${direction === 'right' ? 600 : -600}px) rotate(${direction === 'right' ? 18 : -18}deg)`;
  card.style.opacity = '0';
  setTimeout(done, 220);
}

let homeSwipeInstalled = false;
export function installHomeSwipeOnce() {
  if (homeSwipeInstalled) return;
  homeSwipeInstalled = true;

  let dragging: HTMLElement | null = null;
  let startX = 0, startY = 0, dx = 0, dy = 0;
  let pointerId: number | null = null;

  const threshold = 90;

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a')) return;
    const card = target.closest('.swipe-card[data-stack-pos="0"]') as HTMLElement | null;
    if (!card) return;
    dragging = card;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0; dy = 0;
    card.style.transition = 'none';
    card.setPointerCapture(e.pointerId);
  });

  document.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    const rot = dx / 18;
    dragging.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    const leftHint = dragging.querySelector('.stack-hint.left') as HTMLElement | null;
    const rightHint = dragging.querySelector('.stack-hint.right') as HTMLElement | null;
    const progress = Math.min(1, Math.abs(dx) / threshold);
    if (leftHint) leftHint.style.opacity = dx < 0 ? String(progress) : '0';
    if (rightHint) rightHint.style.opacity = dx > 0 ? String(progress) : '0';
  });

  const endDrag = (e: PointerEvent) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const card = dragging;
    const key = card.getAttribute('data-feed-key') || '';
    dragging = null;
    pointerId = null;
    card.style.transition = 'transform 0.28s cubic-bezier(.2,.7,.3,1), opacity 0.28s ease';

    if (Math.abs(dx) > threshold) {
      const direction = dx > 0 ? 'right' : 'left';
      if (direction === 'right') actOnFeedItem(key);
      else snoozeFeedItem(key);
    } else {
      card.style.transform = 'translate(0,0) rotate(0deg)';
      const leftHint = card.querySelector('.stack-hint.left') as HTMLElement | null;
      const rightHint = card.querySelector('.stack-hint.right') as HTMLElement | null;
      if (leftHint) leftHint.style.opacity = '0';
      if (rightHint) rightHint.style.opacity = '0';
    }
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
}

Object.assign(window as any, {
  snoozeFeedItem,
  actOnFeedItem,
});
