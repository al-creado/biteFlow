const KEY = 'biteflow.v1';
let state = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.orders)) { s.orders.forEach(o => { if (o.status === 'completed') o.status = 'delivered'; }); return s; } } catch (e) {}
  return { next: 1, orders: [] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
const $ = (s, r = document) => r.querySelector(s);
const FLOW = ['new', 'ready', 'delivered'];
const NEXT_LABEL = { new: 'Mark ready ✓', ready: 'Delivered ✓' };
const dlg = $('#dlg'), form = $('#form');
let editingId = null;

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function render() {
  for (const status of FLOW) {
    const col = $(`.col[data-status=${status}]`);
    const orders = state.orders.filter(o => o.status === status);
    if (status === 'delivered') orders.reverse();
    $('.count', col).textContent = orders.length || '';
    $('.list', col).innerHTML = orders.length ? orders.map(card).join('') : '<div class="empty">No orders</div>';
  }
}
function card(o) {
  const items = o.items.map(i => `<li>${esc(i)}</li>`).join('');
  const i = FLOW.indexOf(o.status);
  return `<div class="card" data-id="${o.id}">
    <div class="top"><span class="num">#${o.num}</span><span class="time">${fmt(o.created)}</span></div>
    ${o.name ? `<div class="name">${esc(o.name)}</div>` : ''}
    <ul>${items}</ul>
    ${o.notes ? `<div class="notes">${esc(o.notes)}</div>` : ''}
    <div class="row">
      ${i > 0 ? '<button data-act="back" title="Move back">←</button>' : ''}
      ${i < 2 ? `<button class="primary go" data-act="next">${NEXT_LABEL[o.status]}</button>` : '<span class="go"></span>'}
      <button data-act="edit">Edit</button>
    </div></div>`;
}

function openDlg(o) {
  editingId = o ? o.id : null;
  $('#dlgTitle').textContent = o ? `Edit order #${o.num}` : 'New order';
  $('#fName').value = o ? o.name : '';
  $('#fItems').value = o ? o.items.join('\n') : '';
  $('#fNotes').value = o ? o.notes : '';
  $('#delBtn').style.display = o ? '' : 'none';
  dlg.showModal();
  $('#fItems').focus();
}
form.addEventListener('submit', e => {
  const items = $('#fItems').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!items.length) { e.preventDefault(); return; }
  const data = { name: $('#fName').value.trim(), items, notes: $('#fNotes').value.trim() };
  if (editingId) Object.assign(state.orders.find(o => o.id === editingId), data);
  else state.orders.push({ id: Date.now() + Math.random(), num: state.next++, status: 'new', created: Date.now(), ...data });
  save(); render();
});
$('#cancelBtn').onclick = () => dlg.close();
$('#delBtn').onclick = () => {
  if (!confirm('Delete this order?')) return;
  state.orders = state.orders.filter(o => o.id !== editingId);
  save(); render(); dlg.close();
};
$('#newBtn').onclick = () => openDlg(null);
$('#clearBtn').onclick = () => {
  if (!confirm('Remove all delivered orders?')) return;
  state.orders = state.orders.filter(o => o.status !== 'delivered');
  save(); render();
};
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const o = state.orders.find(x => x.id === Number(b.closest('.card').dataset.id));
  if (!o) return;
  const act = b.dataset.act;
  if (act === 'edit') return openDlg(o);
  o.status = FLOW[FLOW.indexOf(o.status) + (act === 'next' ? 1 : -1)];
  save(); render();
});
render();
