const ICONS = {"list": "<path d=\"M8 6h13M8 12h13M8 18h13\"/><path d=\"M3 6h.01M3 12h.01M3 18h.01\"/>", "download": "<path d=\"M12 4v11\"/><path d=\"M7 11l5 5 5-5\"/><path d=\"M5 20h14\"/>", "plus": "<path d=\"M12 5v14M5 12h14\"/>", "check": "<path d=\"M5 12.5l4.5 4.5L19 7\"/>", "x": "<path d=\"M6 6l12 12M18 6L6 18\"/>", "back": "<path d=\"M19 12H5\"/><path d=\"M11 6l-6 6 6 6\"/>", "edit": "<path d=\"M4 20h4L19 9l-4-4L4 16z\"/>"};
const ic = n => `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const SEED = [
  { name: 'Chicken Cheese Croquette (3 nos)', price: 100 },
  { name: 'Chicken Meat Loaf Sandwich', price: 75 },
  { name: 'Chicken Meat Loaf Bar (450 gms)', price: 500 },
  { name: 'Prawn (Kardi) Potato Chops (3 nos)', price: 120 }
];
const KEY = 'biteflow.v1';
const seedPrice = n => (SEED.find(p => p.name.toLowerCase() === String(n).toLowerCase()) || {}).price || 0;
let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.orders)) {
      s.products = (Array.isArray(s.products) ? s.products : []).map(p =>
        typeof p === 'string' ? { name: p, price: seedPrice(p) } : { name: p.name, price: Number(p.price) || 0 });
      const priceOf = n => (s.products.find(p => p.name === n) || {}).price || 0;
      s.orders.forEach(o => {
        if (o.status === 'completed') o.status = 'delivered';
        o.items = o.items.map(i => {
          if (typeof i === 'string') {
            const m = i.match(/^\s*(\d+)\s*x\s*(.+)$/i);
            i = m ? { name: m[2].trim(), qty: +m[1] } : { name: i, qty: 1 };
          }
          if (typeof i.price !== 'number') i.price = priceOf(i.name);
          return i;
        });
      });
      return s;
    }
  } catch (e) {}
  return { next: 1, orders: [], products: SEED.map(p => ({ ...p })) };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
const $ = (s, r = document) => r.querySelector(s);
const FLOW = ['new', 'ready', 'delivered'];
const NEXT_LABEL = { new: 'Mark ready', ready: 'Delivered' };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const productPrice = n => (state.products.find(p => p.name === n) || {}).price || 0;
const orderTotal = o => o.items.reduce((t, i) => t + i.qty * (i.price || 0), 0);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

const lineQty = l => Math.max(1, parseInt($('input', l).value, 10) || 1);
function updateTotal() {
  let total = 0;
  document.querySelectorAll('#lines .line').forEach(l => {
    const sel = $('select', l).value;
    const sub = sel ? lineQty(l) * Number(l.dataset.price || 0) : 0;
    $('.lp', l).textContent = sel && sub ? money(sub) : '';
    total += sub;
  });
  $('#dtotal').textContent = money(total);
}
function addLine(item) {
  const names = state.products.map(p => p.name);
  if (item.name && !names.includes(item.name)) names.push(item.name);
  const row = document.createElement('div');
  row.className = 'line';
  row.dataset.price = item.name ? (typeof item.price === 'number' ? item.price : productPrice(item.name)) : 0;
  row.innerHTML = `<select><option value="">Select product…</option>${names.map(n => `<option value="${esc(n)}"${n === item.name ? ' selected' : ''}>${esc(n)}${productPrice(n) ? ' - ' + money(productPrice(n)) : ''}</option>`).join('')}</select>
    <input type="number" min="1" value="${item.qty}" aria-label="Quantity"><span class="lp"></span><button type="button" class="x" title="Remove">${ic('x')}</button>`;
  $('select', row).onchange = e => { row.dataset.price = productPrice(e.target.value); updateTotal(); };
  $('input', row).oninput = updateTotal;
  $('.x', row).onclick = () => { row.remove(); updateTotal(); };
  $('#lines').appendChild(row);
  updateTotal();
}
$('#addLine').onclick = () => addLine({ name: '', qty: 1 });

const pdlg = $('#pdlg');
function renderProducts() {
  $('#plist').innerHTML = state.products.map((p, i) => `<li><span class="pn">${esc(p.name)}</span>
    <span class="pp"><span>₹</span><input type="number" min="0" step="any" value="${p.price}" data-i="${i}" aria-label="Price of ${esc(p.name)}"></span>
    <button data-i="${i}" data-del="1">Remove</button></li>`).join('') || '<li class="empty">No products yet</li>';
}
$('#prodBtn').onclick = () => { renderProducts(); pdlg.showModal(); $('#pName').focus(); };
$('#seedBtn').onclick = () => {
  SEED.forEach(s => {
    const ex = state.products.find(p => p.name.toLowerCase() === s.name.toLowerCase());
    if (!ex) state.products.push({ ...s }); else if (!ex.price) ex.price = s.price;
  });
  save(); renderProducts();
};
$('#pClose').onclick = () => pdlg.close();
$('#pform').onsubmit = e => {
  e.preventDefault();
  const n = $('#pName').value.trim(), price = Math.max(0, Number($('#pPrice').value) || 0);
  if (n) {
    const ex = state.products.find(p => p.name.toLowerCase() === n.toLowerCase());
    if (ex) ex.price = price; else state.products.push({ name: n, price });
    save(); renderProducts();
  }
  $('#pName').value = ''; $('#pPrice').value = ''; $('#pName').focus();
};
$('#plist').onclick = e => {
  const b = e.target.closest('button[data-del]'); if (!b) return;
  state.products.splice(+b.dataset.i, 1); save(); renderProducts();
};
$('#plist').onchange = e => {
  const inp = e.target.closest('input[data-i]'); if (!inp) return;
  state.products[+inp.dataset.i].price = Math.max(0, Number(inp.value) || 0); save();
};

const dlg = $('#dlg'), form = $('#form');
let editingId = null;

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
  const items = o.items.map(i => `<li><span><b>${i.qty}×</b> ${esc(i.name)}</span>${i.price ? `<span class="lp">${money(i.qty * i.price)}</span>` : ''}</li>`).join('');
  const total = orderTotal(o);
  const i = FLOW.indexOf(o.status);
  return `<div class="card" data-id="${o.id}">
    <div class="top"><span class="num">#${o.num}</span><span class="time">${fmt(o.created)}</span></div>
    ${o.name ? `<div class="name">${esc(o.name)}</div>` : ''}
    <ul>${items}</ul>
    ${total ? `<div class="ctotal"><span>Total</span><b>${money(total)}</b></div>` : ''}
    ${o.notes ? `<div class="notes">${esc(o.notes)}</div>` : ''}
    <div class="row">
      ${i > 0 ? `<button data-act="back" title="Move back" aria-label="Move back">${ic('back')}</button>` : ''}
      ${i < 2 ? `<button class="primary go" data-act="next">${ic('check')} ${NEXT_LABEL[o.status]}</button>` : '<span class="go"></span>'}
      <button data-act="edit">${ic('edit')} Edit</button>
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
    name: $('select', l).value, qty: lineQty(l), price: Number(l.dataset.price) || 0
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
  const rows = [['Order #', 'Status', 'Created', 'Customer', 'Items', 'Total', 'Notes']];
  for (const o of state.orders) {
    const d = new Date(o.created), p = n => String(n).padStart(2, '0');
    const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    rows.push([o.num, label[o.status], when, o.name, o.items.map(i => `${i.qty}x ${i.name}`).join('; '), orderTotal(o), o.notes]);
  }
  // numbers unquoted so Excel treats Total as a number
  const csv = '﻿' + rows.map(r => r.map((v, i) => (i === 5 && typeof v === 'number') ? v : q(v)).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `amylicious-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
render();
