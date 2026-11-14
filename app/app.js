const KEY = 'biteflow.v1';
let state = load();
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.orders)) {
      s.products = Array.isArray(s.products) ? s.products : [];
      s.orders.forEach(o => {
        if (o.status === 'completed') o.status = 'delivered';
        o.items = o.items.map(i => {
          if (typeof i !== 'string') return i;
          const m = i.match(/^\s*(\d+)\s*x\s*(.+)$/i);
          return m ? { name: m[2].trim(), qty: +m[1] } : { name: i, qty: 1 };
        });
      });
      return s;
    } } catch (e) {}
  return { next: 1, orders: [], products: [] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
const $ = (s, r = document) => r.querySelector(s);
const FLOW = ['new', 'ready', 'delivered'];
const NEXT_LABEL = { new: 'Mark ready ✓', ready: 'Delivered ✓' };
function addLine(item) {
  const names = state.products.slice();
  if (item.name && !names.includes(item.name)) names.push(item.name);
  const row = document.createElement('div');
  row.className = 'line';
  row.innerHTML = `<select><option value="">Select product…</option>${names.map(n => `<option${n === item.name ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <input type="number" min="1" value="${item.qty}" aria-label="Quantity"><button type="button" class="x" title="Remove">✕</button>`;
  $('.x', row).onclick = () => row.remove();
  $('#lines').appendChild(row);
}
$('#addLine').onclick = () => addLine({ name: '', qty: 1 });

const pdlg = $('#pdlg');
function renderProducts() {
  $('#plist').innerHTML = state.products.map((n, i) => `<li><span>${esc(n)}</span><button data-i="${i}">Remove</button></li>`).join('') || '<li class="empty">No products yet</li>';
}
$('#prodBtn').onclick = () => { renderProducts(); pdlg.showModal(); $('#pName').focus(); };
$('#pClose').onclick = () => pdlg.close();
$('#pform').onsubmit = e => {
  e.preventDefault();
  const n = $('#pName').value.trim();
  if (n && !state.products.some(p => p.toLowerCase() === n.toLowerCase())) { state.products.push(n); save(); renderProducts(); }
  $('#pName').value = ''; $('#pName').focus();
};
$('#plist').onclick = e => {
  const b = e.target.closest('button[data-i]'); if (!b) return;
  state.products.splice(+b.dataset.i, 1); save(); renderProducts();
};

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
  const items = o.items.map(i => `<li><b>${i.qty}×</b> ${esc(i.name)}</li>`).join('');
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
  $('#lines').innerHTML = '';
  (o ? o.items : [{ name: '', qty: 1 }]).forEach(addLine);
  $('#noProd').hidden = state.products.length > 0 || !!(o && o.items.length);
  $('#fNotes').value = o ? o.notes : '';
  $('#delBtn').style.display = o ? '' : 'none';
  dlg.showModal();
}
form.addEventListener('submit', e => {
  const items = [...document.querySelectorAll('#lines .line')].map(l => ({
    name: $('select', l).value, qty: Math.max(1, parseInt($('input', l).value, 10) || 1)
  })).filter(i => i.name);
  if (!items.length) { e.preventDefault(); alert('Add at least one product with a quantity.'); return; }
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
$('#exportBtn').onclick = () => {
  const q = v => '"' + String(v).replace(/"/g, '""') + '"';
  const label = { new: 'New', ready: 'Ready', delivered: 'Delivered' };
  const rows = [['Order #', 'Status', 'Created', 'Name / table', 'Items', 'Notes']];
  for (const o of state.orders) {
    const d = new Date(o.created), p = n => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    rows.push([o.num, label[o.status], when, o.name, o.items.map(i => `${i.qty}x ${i.name}`).join('; '), o.notes]);
  }
  const csv = '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `biteflow-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
render();
