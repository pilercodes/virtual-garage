import { readReceipt } from './receipt-reader.js';

const maxBytes = 10 * 1024 * 1024;
const maxReceipts = 5;

function node(tag, label) {
  const item = document.createElement(tag);
  if (label) item.textContent = label;
  return item;
}

function addField(parent, label, type) {
  const wrapper = node('label', label);
  const input = node('input');
  input.type = type;
  wrapper.append(input);
  parent.append(wrapper);
  return input;
}

function button(text, action) {
  const item = node('button', text);
  item.type = 'button';
  item.className = 'secondary';
  item.addEventListener('click', action);
  return item;
}

export function mountReceiptEditor(form, allowSuggestions) {
  const output = node('details');
  output.className = 'receipt-editor';
  output.append(node('summary', 'Scan or attach receipts'));
  output.append(node('p', 'Receipt reading runs in this browser. Review suggestions before saving. Receipt totals stay separate from log costs.'));
  const inputs = [
    addField(output, 'Choose receipt files', 'file'),
    addField(output, 'Photograph a receipt', 'file')
  ];
  inputs[0].accept = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
  inputs[0].multiple = true;
  inputs[1].accept = 'image/*';
  inputs[1].setAttribute('capture', 'environment');
  const results = node('div');
  const status = node('p');
  status.setAttribute('role', 'status');
  output.append(status, results);
  form.append(output);
  const staged = [];
  let reading = false;
  const originalDate = form.elements.date.value;
  let dateEdited = !allowSuggestions;
  form.elements.date.addEventListener('input', () => { dateEdited = true; });

  function stage(file) {
    const row = node('section');
    row.className = 'workshop-item receipt-suggestion';
    row.append(node('h3', file.name));
    const feedback = node('p', 'Preparing receipt…');
    feedback.setAttribute('role', 'status');
    row.append(feedback);
    const retailer = addField(row, 'Retailer', 'text');
    retailer.maxLength = 200;
    const date = addField(row, 'Purchase date', 'date');
    const total = addField(row, 'Receipt total (USD)', 'number');
    total.min = '0';
    total.step = '0.01';
    total.max = '9999999.99';
    const entry = { id: crypto.randomUUID(), file, retailer, date, total, saved: false };
    const remove = button('Remove receipt', () => {
      staged.splice(staged.indexOf(entry), 1);
      row.remove();
    });
    row.append(remove);
    staged.push(entry);
    results.append(row);
    return { entry, feedback, row, remove };
  }

  async function suggest({ entry, feedback, row, remove }) {
    const touched = new Set();
    for (const field of [entry.retailer, entry.date, entry.total]) field.addEventListener('input', () => touched.add(field));
    try {
      const data = await readReceipt(entry.file, message => { feedback.textContent = message; });
      if (!row.isConnected) return;
      if (!touched.has(entry.retailer)) entry.retailer.value = data.retailer;
      if (!touched.has(entry.date)) entry.date.value = data.date;
      if (!touched.has(entry.total) && data.total != null) entry.total.value = (data.total / 100).toFixed(2);
      const extracted = data.retailer || data.date || data.total != null || data.items.length || data.parts != null || data.labor != null;
      feedback.textContent = extracted ? 'Review the detected details.' : 'No details confidently detected. You can enter them manually.';
      if (data.items.length) {
        const details = node('details');
        details.append(node('summary', 'Detected line items'));
        const list = node('ul');
        for (const item of data.items) list.append(node('li', item));
        details.append(list);
        row.insertBefore(details, remove);
      }
      if (data.parts != null) row.insertBefore(node('p', 'Detected parts subtotal: $' + (data.parts / 100).toFixed(2)), remove);
      if (data.labor != null) row.insertBefore(node('p', 'Detected labor subtotal: $' + (data.labor / 100).toFixed(2)), remove);
      if (extracted) row.insertBefore(button('Apply suggestions to empty log fields', event => {
        const applied = [];
        const set = (name, value, label) => {
          const input = form.elements[name];
          if (value && input && !input.value.trim()) {
            input.value = value;
            input.closest('details')?.setAttribute('open', '');
            applied.push(label);
          }
        };
        set('title', entry.retailer.value.trim() ? ('Receipt from ' + entry.retailer.value.trim()).slice(0, 120) : '', 'title');
        if (entry.date.value && !dateEdited && form.elements.date.value === originalDate) {
          form.elements.date.value = entry.date.value;
          dateEdited = true;
          applied.push('log date');
        }
        set('notes', data.items.length ? 'Receipt line items (reviewed from scan):\n' + data.items.join('\n') : '', 'notes');
        // The receipt total never enters expense fields.
        feedback.textContent = applied.length ? 'Applied to ' + applied.join(', ') + '.' : 'Your existing log fields were kept.';
        event.currentTarget.disabled = true;
      }), remove);
      if (data.parts != null || data.labor != null) row.insertBefore(button('Apply verified parts or labor', event => {
        const applied = [];
        const hasInventory = new FormData(form).getAll('partIds').length || form.elements.newPart?.value.trim();
        for (const [field, amount, safe] of [['partsCost', data.parts, !hasInventory], ['laborCost', data.labor, true]]) {
          const input = form.elements[field];
          if (safe && amount != null && input && input.value === '') {
            input.value = (amount / 100).toFixed(2);
            input.closest('details')?.setAttribute('open', '');
            applied.push(field === 'partsCost' ? 'parts' : 'labor');
          }
        }
        feedback.textContent = applied.length ? 'Applied ' + applied.join(' and ') + '. Check against any costs already recorded.'
          : 'No empty, eligible cost fields. Linked inventory costs are handled separately.';
        event.currentTarget.disabled = true;
      }), remove);
    } catch {
      feedback.textContent = 'Couldn’t read this receipt. You can still attach it and enter the details manually.';
    }
  }

  for (const input of inputs) input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length || reading) return;
    reading = true;
    for (const picker of inputs) picker.disabled = true;
    const errors = [];
    try {
      const pending = [];
      for (const file of files) {
        if (staged.length >= maxReceipts) {
          errors.push('Attach up to five receipts at a time.');
          break;
        }
        if (!file.size || file.size > maxBytes) {
          errors.push(file.name + ' must be between 1 byte and 10 MB.');
          continue;
        }
        if (staged.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
        pending.push(stage(file));
      }
      status.textContent = errors.join(' ');
      for (const item of pending) if (item.row.isConnected) await suggest(item);
    } finally {
      reading = false;
      for (const picker of inputs) picker.disabled = false;
    }
  });

  return {
    assertReady() {
      if (reading) throw new Error('Wait for receipt reading to finish, then save the log.');
    },
    async uploadAll(upload) {
      for (const entry of staged) {
        if (entry.saved) continue;
        const total = entry.total.value === '' ? null : Math.round(Number(entry.total.value) * 100);
        await upload(entry.id, entry.file, { retailer: entry.retailer.value, date: entry.date.value, cost: total });
        entry.saved = true;
        entry.retailer.closest('section').remove();
      }
    },
    lockLogFields() {
      for (const field of form.elements) {
        if (!output.contains(field) && !['submit', 'button'].includes(field.type)) field.disabled = true;
      }
      output.open = true;
    }
  };
}
