const ICONS = {"list": "<path d=\"M8 6h13M8 12h13M8 18h13\"/><path d=\"M3 6h.01M3 12h.01M3 18h.01\"/>", "download": "<path d=\"M12 4v11\"/><path d=\"M7 11l5 5 5-5\"/><path d=\"M5 20h14\"/>", "plus": "<path d=\"M12 5v14M5 12h14\"/>", "check": "<path d=\"M5 12.5l4.5 4.5L19 7\"/>", "minus": "<path d=\"M5 12h14\"/>", "x": "<path d=\"M6 6l12 12M18 6L6 18\"/>", "back": "<path d=\"M19 12H5\"/><path d=\"M11 6l-6 6 6 6\"/>", "chev": "<path d=\"M6 9l6 6 6-6\"/>", "edit": "<path d=\"M4 20h4L19 9l-4-4L4 16z\"/>"};
const ic = n => `<svg class="ic" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const SEED = [
  { name: 'Chicken Cheese Croquette (3 nos)', price: 100 },
  { name: 'Chicken Meat Loaf Sandwich', price: 75 },
  { name: 'Chicken Meat Loaf Bar (450 gms)', price: 500 },
  { name: 'Prawn (Kardi) Potato Chops (3 nos)', price: 120 }
];
const PALETTE = [
  ['#FFD6E8', '#C73B85'], ['#CFF1DD', '#26784A'], ['#D3E8FF', '#2B6CB0'], ['#FFF0B8', '#7A6100'],
  ['#E5DBFF', '#6B46C1'], ['#FFDCC7', '#A9440F'], ['#C9F0F0', '#0F766E'], ['#E3F3C2', '#4F6F0D']
];
let state = { orders: [], products: [], history: [], status: 'synced' };
let store = null, unsubscribe = null;
function setStore(next) {
  if (unsubscribe) unsubscribe();
  store = next; unsubscribe = null;
  if (!next) { state = { orders: [], products: [], history: [], status: 'synced' }; render(); return; }
  unsubscribe = next.subscribe(snap => {
    state = snap;
    Auth.setSyncStatus(snap.status, next.kind);
    render();
    const pl = document.getElementById('plist');
    if (pdlg.open && !(pl && pl.contains(document.activeElement))) renderProducts();
  });
}
const $ = (s, r = document) => r.querySelector(s);
const FLOW = ['new', 'ready', 'delivered'];
const NEXT_LABEL = { new: 'Mark ready', ready: 'Delivered' };
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const colorOf = n => {
  const p = state.products.find(x => x.name === n);
  if (p && Number.isInteger(p.c)) return PALETTE[p.c % PALETTE.length];
  let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
};
const colorStyle = n => { const [bg, ac] = colorOf(n); return `--bg:${bg};--ac:${ac}`; };
const productPrice = n => (state.products.find(p => p.name === n) || {}).price || 0;
const orderTotal = o => o.items.reduce((t, i) => t + i.qty * (i.price || 0), 0);
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

const titleCase = s => String(s).replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

let ddCount = 0, openDD = null;
function closeDD() {
  if (!openDD) return;
  openDD.list.hidden = true; openDD.btn.setAttribute('aria-expanded', 'false'); openDD = null;
}
document.addEventListener('pointerdown', e => { if (openDD && !openDD.root.contains(e.target)) closeDD(); });
window.addEventListener('resize', closeDD);
function makeDropdown(options, value, onChange) {
  const root = document.createElement('div');
  root.className = 'dd';
  const id = 'dd' + (++ddCount);
  root.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}"><span class="dd-val"></span>${ic('chev')}</button><ul class="dd-list" role="listbox" id="${id}" hidden></ul>`;
  const btn = $('.dd-btn', root), list = $('.dd-list', root), label = $('.dd-val', root);
  let current = value || '', active = -1;
  const self = { root, btn, list };
  function paint() {
    label.textContent = current || 'Select product';
    label.classList.toggle('ph', !current);
    list.innerHTML = options.length ? options.map((o, i) => `<li role="option" data-i="${i}" aria-selected="${o.name === current}" class="${o.name === current ? 'sel' : ''}"><span class="dd-name"><i class="dot" style="background:${colorOf(o.name)[1]}"></i>${esc(o.name)}</span><span class="dd-price">${o.price ? money(o.price) : ''}</span></li>`).join('') : '<li class="dd-empty">No products yet</li>';
  }
  function setActive(i) {
    active = Math.max(0, Math.min(options.length - 1, i));
    list.querySelectorAll('li').forEach((li, k) => li.classList.toggle('active', k === active));
    const li = list.children[active]; if (li) li.scrollIntoView({ block: 'nearest' });
  }
  function open() {
    closeDD(); paint();
    const r = btn.getBoundingClientRect();
    const below = innerHeight - r.bottom - 12, above = r.top - 12;
    const up = below < 170 && above > below;
    list.style.left = r.left + 'px'; list.style.width = r.width + 'px';
    list.style.maxHeight = Math.max(120, Math.min(260, up ? above : below)) + 'px';
    list.style.top = up ? 'auto' : r.bottom + 4 + 'px';
    list.style.bottom = up ? innerHeight - r.top + 4 + 'px' : 'auto';
    list.hidden = false; btn.setAttribute('aria-expanded', 'true'); openDD = self;
    setActive(Math.max(0, options.findIndex(o => o.name === current)));
  }
  function choose(i) {
    const o = options[i]; if (!o) return;
    current = o.name; closeDD(); paint(); btn.focus(); onChange(current);
  }
  btn.onclick = () => (openDD === self ? closeDD() : open());
  list.onmousedown = e => e.preventDefault();
  list.onclick = e => { const li = e.target.closest('li[data-i]'); if (li) choose(+li.dataset.i); };
  btn.onkeydown = e => {
    const isOpen = openDD === self;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) open(); else setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Home' && isOpen) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && isOpen) { e.preventDefault(); setActive(options.length - 1); }
    else if ((e.key === 'Enter' || e.key === ' ') && isOpen) { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' && isOpen) { e.preventDefault(); e.stopPropagation(); closeDD(); }
    else if (e.key === 'Tab') closeDD();
  };
  paint();
  return self;
}

const lineQty = l => Math.max(1, parseInt($('.qty', l).value, 10) || 1);
function updateTotal() {
  let total = 0;
  document.querySelectorAll('#lines .line').forEach(l => {
    const sel = l.dataset.name;
    const sub = sel ? lineQty(l) * Number(l.dataset.price || 0) : 0;
    $('.lp', l).textContent = sel && sub ? money(sub) : '';
    total += sub;
  });
  $('#dtotal').textContent = money(total);
}
function addLine(item) {
  const options = state.products.map(p => ({ name: p.name, price: p.price }));
  if (item.name && !options.some(o => o.name === item.name)) options.push({ name: item.name, price: item.price || 0 });
  const row = document.createElement('div');
  row.className = 'line';
  row.dataset.name = item.name || '';
  if (item.name) row.style.cssText = colorStyle(item.name);
  row.dataset.price = item.name ? (typeof item.price === 'number' ? item.price : productPrice(item.name)) : 0;
  const dd = makeDropdown(options, item.name, v => {
    const o = options.find(x => x.name === v);
    row.style.cssText = colorStyle(v);
    row.dataset.name = v; row.dataset.price = state.products.some(p => p.name === v) ? productPrice(v) : (o ? o.price : 0);
    updateTotal();
  });
  row.appendChild(dd.root);
  const foot = document.createElement('div');
  foot.className = 'line-foot';
  foot.innerHTML = `<div class="stepper"><button type="button" class="step" data-d="-1" aria-label="Decrease quantity">${ic('minus')}</button><input class="qty" type="number" min="1" value="${item.qty}" aria-label="Quantity"><button type="button" class="step" data-d="1" aria-label="Increase quantity">${ic('plus')}</button></div>
    <span class="lp"></span><button type="button" class="x" title="Remove item" aria-label="Remove item">${ic('x')}</button>`;
  foot.onclick = e => {
    const st = e.target.closest('.step');
    if (st) { const q = $('.qty', row); q.value = Math.max(1, lineQty(row) + +st.dataset.d); updateTotal(); }
  };
  $('.qty', foot).oninput = updateTotal;
  $('.x', foot).onclick = () => { closeDD(); row.remove(); updateTotal(); };
  row.appendChild(foot);
  $('#lines').appendChild(row);
  updateTotal();
}
$('#addLine').onclick = () => addLine({ name: '', qty: 1 });

const pdlg = $('#pdlg');
function renderProducts() {
  $('#plist').innerHTML = state.products.map(p => `<li><span class="pn">${esc(p.name)}</span>
    <span class="pp"><span>₹</span><input type="number" min="0" step="any" value="${p.price}" data-id="${esc(p.id)}" aria-label="Price of ${esc(p.name)}"></span>
    <button data-id="${esc(p.id)}" data-del="1">Remove</button></li>`).join('') || '<li class="empty">No products yet</li>';
  // previous menu: every product ever added that is not on the menu right now
  const onMenu = new Set(state.products.map(p => p.name.toLowerCase()));
  const missing = (state.history || []).filter(h => !onMenu.has(h.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  $('#histWrap').hidden = !missing.length;
  $('#hlist').innerHTML = missing.map(h => `<li><span class="pn">${Number.isInteger(h.c) ? `<i class="dot" style="background:${PALETTE[h.c % PALETTE.length][1]}"></i>` : ''}${esc(h.name)}</span>
    <span class="hp">${h.price ? money(h.price) : ''}</span>
    <button data-add="${esc(h.id)}">Add</button>
    <button class="icon-btn" data-forget="${esc(h.id)}" title="Remove from previous menu" aria-label="Remove ${esc(h.name)} from previous menu">${ic('x')}</button></li>`).join('');
}
$('#prodBtn').onclick = () => { renderProducts(); pdlg.showModal(); $('#pName').focus(); };
$('#pClose').onclick = () => pdlg.close();
$('#pform').onsubmit = async e => {
  e.preventDefault();
  const n = $('#pName').value.trim(), price = Math.max(0, Number($('#pPrice').value) || 0);
  if (n) { await store.upsertProduct({ name: n, price }); renderProducts(); }
  $('#pName').value = ''; $('#pPrice').value = ''; $('#pName').focus();
};
$('#plist').onclick = async e => {
  const b = e.target.closest('button[data-del]'); if (!b) return;
  await store.removeProduct(b.dataset.id); renderProducts();
};
$('#hlist').onclick = async e => {
  const add = e.target.closest('button[data-add]'), forget = e.target.closest('button[data-forget]');
  if (add) await store.restoreProduct(add.dataset.add);
  else if (forget) await store.forgetHistory(forget.dataset.forget);
  else return;
  renderProducts();
};
$('#histAll').onclick = async () => { await store.restoreAll(); renderProducts(); };
$('#plist').onchange = e => {
  const inp = e.target.closest('input[data-id]'); if (!inp) return;
  store.setProductPrice(inp.dataset.id, Math.max(0, Number(inp.value) || 0));
};

const dlg = $('#dlg'), form = $('#form');
let editingId = null;

function render() {
  for (const status of FLOW) {
    const col = $(`.col[data-status=${status}]`);
    const orders = state.orders.filter(o => o.status === status).sort((a, b) => a.num - b.num);
    if (status === 'delivered') orders.reverse();
    $('.count', col).textContent = orders.length || '';
    $('.list', col).innerHTML = orders.length ? orders.map(card).join('') : '<div class="empty">No orders</div>';
  }
}
function card(o) {
  const items = o.items.map(i => `<li style="${colorStyle(i.name)}"><span class="q">${i.qty}×</span><span class="nm">${esc(i.name)}</span>${i.price ? `<span class="lp">${money(i.qty * i.price)}</span>` : '<span></span>'}</li>`).join('');
  const total = orderTotal(o);
  const i = FLOW.indexOf(o.status);
  return `<div class="card" data-id="${o.id}">
    <div class="top"><span class="num">#${o.num}</span><span class="time">${fmt(o.created)}</span></div>
    ${o.name ? `<div class="name">${esc(titleCase(o.name))}</div>` : ''}
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
    name: l.dataset.name, qty: lineQty(l), price: Number(l.dataset.price) || 0
  })).filter(i => i.name);
  if (!items.length) { e.preventDefault(); alert('Add at least one product with a quantity.'); return; }
  const data = { name: titleCase($('#fName').value.trim()), items, notes: $('#fNotes').value.trim() };
  if (editingId) store.updateOrder(editingId, data); else store.addOrder(data);
});
$('#cancelBtn').onclick = () => dlg.close();
dlg.addEventListener('cancel', e => { if (openDD) e.preventDefault(); });
dlg.addEventListener('close', closeDD);
dlg.addEventListener('scroll', closeDD, true);
$('#fName').addEventListener('blur', e => { e.target.value = titleCase(e.target.value); });
$('#delBtn').onclick = () => {
  if (!confirm('Delete this order?')) return;
  store.deleteOrder(editingId); dlg.close();
};
$('#newBtn').onclick = () => openDlg(null);
$('#clearBtn').onclick = () => {
  if (!confirm('Remove all delivered orders?')) return;
  store.clearDelivered();
};
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const o = state.orders.find(x => x.id === b.closest('.card').dataset.id);
  if (!o) return;
  const act = b.dataset.act;
  if (act === 'edit') return openDlg(o);
  store.setStatus(o.id, FLOW[FLOW.indexOf(o.status) + (act === 'next' ? 1 : -1)]);
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
const memoryStorage = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; })();
let storage = memoryStorage;
try { storage = window.localStorage; storage.getItem('biteflow.v1'); } catch (e) { storage = memoryStorage; }
Auth.start({ localFactory: () => Store.createLocalStore({ storage, seed: SEED }), onStore: next => setStore(next) });
