import { expenseSummary, partState, nextService } from './workshop-model.js';
const logTypes = { maintenance: 'Maintenance', repair: 'Repair', upgrade: 'Upgrade / Modification', inspection: 'Inspection / Diagnosis' };
const partStatuses = { planned: 'Planned', purchased: 'Purchased', installed: 'Installed', removed: 'Removed', replaced: 'Replaced' };
const logStatuses = { planned: 'Planned', 'in-progress': 'In Progress', completed: 'Completed' };
const dollars = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
const shortDate = value => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z')) : '—';

function workshopNode(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function workshopButton(text, run, kind = 'secondary') {
  const button = workshopNode('button', text, kind);
  button.type = 'button';
  button.addEventListener('click', run);
  return button;
}

function workshopField(name, title, value = '', type = 'text', options = null) {
  const label = workshopNode('label', title);
  const field = workshopNode(options ? 'select' : type === 'textarea' ? 'textarea' : 'input');
  field.name = name;
  if (options) for (const [key, text] of Object.entries(options)) field.add(new Option(text, key));
  else if (type !== 'textarea') field.type = type;
  field.value = value ?? '';
  if (type === 'number') field.min = '0';
  label.append(field);
  return label;
}

function dollarsToCents(value) {
  return value === '' || value == null ? null : Math.round(Number(value) * 100);
}

export function workshopFileUrl(vehicle, id, garage, download = false) {
  const params = new URLSearchParams();
  if (garage) params.set('garage', garage);
  if (download) params.set('download', '1');
  return '/api/workshop/' + vehicle + '/files/' + id + '?' + params;
}

async function imageUpload(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size < 1200000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: blob.type }) : file;
  } catch {
    return file;
  }
}

export function mountWorkshop(root, vehicle, garage, api, updatePhoto) {
  const contents = workshopNode('div', null, 'workshop-content');
  const status = workshopNode('p', 'Loading vehicle activity…', 'workshop-status');
  status.setAttribute('role', 'status');
  const actions = workshopNode('div', null, 'workshop-tabs');
  const shell = workshopNode('div');
  shell.append(actions, status, contents);
  root.replaceChildren(shell);
  const editor = workshopNode('dialog');
  const viewer = workshopNode('dialog', null, 'workshop-viewer');
  shell.append(editor, viewer);
  const base = 'workshop/' + vehicle.id + '/';
  const url = (id, download = false) => workshopFileUrl(vehicle.id, id, garage, download);
  let logs = [];
  let files = [];
  let records = [];
  let tab = 'activity';
  let disposed = false;
  let partQuery = '';
  const filter = { query: '', type: '', status: '', start: '', end: '', sort: 'date' };

  function write(path, method, body) {
    return api(base + path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  async function refresh() {
    [logs, files, records] = await Promise.all([api(base + 'logs'), api(base + 'files'), api(base + 'records')]);
    if (!shell.isConnected || disposed) return;
    updatePhoto(files.find(file => file.target === 'vehicle')?.id);
    render();
  }

  async function run(block, job, feedback = status) {
    if (block) block.disabled = true;
    feedback.textContent = '';
    try {
      await job();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      if (block) block.disabled = false;
    }
  }

  function edit(title, build, save, afterSave) {
    const form = workshopNode('form');
    const heading = workshopNode('h2', title);
    heading.id = 'workshop-editor-title';
    editor.setAttribute('aria-labelledby', heading.id);
    const problem = workshopNode('p', '', 'workshop-status');
    problem.setAttribute('role', 'alert');
    const buttons = workshopNode('div', null, 'account-actions');
    const close = workshopButton('Cancel', () => editor.close());
    const submit = workshopNode('button', 'Save', 'primary');
    submit.type = 'submit';
    buttons.append(close, submit);
    form.append(heading);
    build(form);
    form.append(problem, buttons);
    form.addEventListener('submit', event => {
      event.preventDefault();
      run(submit, async () => {
        const result = await save(Object.fromEntries(new FormData(form)), form);
        editor.close();
        await refresh();
        afterSave?.(result);
      }, problem);
    });
    editor.replaceChildren(form);
    editor.showModal();
  }

  function openGallery(list, start) {
    let position = start;
    const show = () => {
      const item = list[position];
      const img = workshopNode('img');
      img.src = url(item.id);
      img.alt = item.detail.caption || item.name;
      const buttons = workshopNode('div', null, 'account-actions');
      buttons.append(workshopButton('Previous', () => { position = (position + list.length - 1) % list.length; show(); }),
        workshopButton('Next', () => { position = (position + 1) % list.length; show(); }),
        workshopButton('Close', () => viewer.close()));
      viewer.replaceChildren(img, workshopNode('p', img.alt), buttons);
    };
    viewer.setAttribute('aria-label', 'Full-size photo gallery');
    show();
    viewer.showModal();
  }

  function attachments(target, options = {}) {
    const area = workshopNode('div', null, 'workshop-attachments');
    const items = files.filter(file => file.target === target);
    const images = items.filter(file => file.mime.startsWith('image/') && !options.document);
    const grid = workshopNode('div', null, 'workshop-files');
    for (const item of items) {
      const tile = workshopNode('article', null, 'workshop-item');
      if (images.includes(item)) {
        const thumb = workshopButton('', () => openGallery(images, images.indexOf(item)), 'workshop-image-button');
        const img = workshopNode('img');
        img.src = url(item.id);
        img.alt = item.detail.caption || item.name;
        img.loading = 'lazy';
        thumb.append(img);
        tile.append(thumb);
      } else {
        const link = workshopNode('a', item.name);
        link.href = url(item.id, true);
        link.download = item.name;
        tile.append(link);
      }
      const caption = [item.detail.caption, item.detail.retailer, item.detail.date,
        item.detail.cost == null ? '' : dollars(item.detail.cost)].filter(Boolean).join(' · ');
      if (caption) tile.append(workshopNode('p', caption));
      const buttons = workshopNode('div', null, 'account-actions');
      buttons.append(workshopButton('Details', () => edit('Attachment details', form => {
        form.append(workshopField('caption', 'Caption', item.detail.caption));
        if (options.document) {
          form.append(workshopField('retailer', 'Retailer', item.detail.retailer), workshopField('date', 'Purchase date', item.detail.date, 'date'),
            workshopField('cost', 'Cost (USD)', item.detail.cost == null ? '' : item.detail.cost / 100, 'number'));
          form.elements.cost.step = '0.01';
        }
      }, data => write('files/' + item.id, 'PUT', { ...data, cost: dollarsToCents(data.cost), position: item.position }))),
      workshopButton('Delete', event => {
        if (confirm('Delete this attachment?')) run(event.currentTarget, async () => { await write('files/' + item.id, 'DELETE'); await refresh(); });
      }));
      const index = items.indexOf(item);
      if (index > 0) buttons.append(workshopButton('Move earlier', event => run(event.currentTarget, async () => {
        await write('files/' + item.id, 'PUT', { ...item.detail, position: Math.max(0, items[index - 1].position - 1) });
        await refresh();
      })));
      if (images.includes(item) && items[0] !== item && !options.noCover) buttons.append(workshopButton('Make cover', event =>
        run(event.currentTarget, async () => {
          await write('files/' + item.id, 'PUT', { ...item.detail, position: Math.max(0, items[0].position - 1) });
          await refresh();
        })));
      tile.append(buttons);
      grid.append(tile);
    }
    const upload = (label, camera = false) => {
      const wrapper = workshopNode('label', label);
      const input = workshopNode('input');
      input.type = 'file';
      input.accept = options.document ? 'application/pdf,image/*' : 'image/jpeg,image/png,image/webp,image/gif';
      input.multiple = !camera;
      if (camera) input.setAttribute('capture', 'environment');
      input.addEventListener('change', () => run(input, async () => {
        const errors = [];
        for (const original of input.files) {
          try {
            const file = options.document ? original : await imageUpload(original);
            const query = new URLSearchParams({ name: file.name, target });
            await api(base + 'files?' + query, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
          } catch (error) { errors.push(error.message); }
        }
        input.value = '';
        await refresh();
        if (errors.length) throw new Error(errors.join(' '));
        status.textContent = 'Upload complete.';
      }));
      wrapper.append(input);
      return wrapper;
    };
    area.append(grid, upload(options.document ? 'Upload receipts or documents' : 'Upload photos'));
    if (!options.document) area.append(upload('Take photo', true));
    return area;
  }

  function logEditor(log = {}) {
    edit(log.id ? 'Edit log entry' : 'Add Log Entry', form => {
      const title = workshopField('title', 'Title', log.title);
      title.lastChild.required = true;
      const date = workshopField('date', 'Date', log.date || new Date().toISOString().slice(0, 10), 'date');
      date.lastChild.required = true;
      form.append(title, workshopField('type', 'Log type', log.type || 'maintenance', 'text', logTypes),
        workshopField('status', 'Status', log.status || 'completed', 'text', logStatuses), date,
        workshopField('mileage', 'Odometer (mi)', log.mileage, 'number'), workshopField('notes', 'Description and notes', log.notes, 'textarea'),
        workshopField('cost', 'Other cost (USD)', log.expenses ? log.expenses.misc / 100 : log.cost == null ? '' : log.cost / 100, 'number'));
      form.elements.cost.step = '0.01';
      const extras = workshopNode('details');
      extras.append(workshopNode('summary', 'Parts and itemized costs'),
        workshopField('partsCost', 'Additional parts cost (USD)', log.expenses?.parts == null ? '' : log.expenses.parts / 100, 'number'),
        workshopField('laborCost', 'Labor cost (USD)', log.expenses?.labor == null ? '' : log.expenses.labor / 100, 'number'),
        workshopNode('p', 'Enter inventory purchase prices on the part. Include only additional costs here.'),
        workshopField('partAction', 'Action for linked parts', log.partAction || '', 'text',
          { '': 'Serviced / referenced', installed: 'Installed', removed: 'Removed', replaced: 'Replaced' }));
      const parts = workshopNode('fieldset');
      parts.append(workshopNode('legend', 'Link existing parts'));
      for (const part of records.filter(record => record.kind === 'part')) {
        const label = workshopNode('label', part.title);
        const check = workshopNode('input');
        check.type = 'checkbox'; check.name = 'partIds'; check.value = part.id; check.checked = log.partIds?.includes(part.id) || false;
        label.append(check); parts.append(label);
      }
      extras.append(parts);
      const newPart = workshopNode('div');
      if (!log.id) newPart.append(workshopField('newPart', 'New part name', ''), workshopField('newPartBrand', 'New part brand'),
        workshopField('newPartNumber', 'New part number'), workshopField('newPartPrice', 'New part purchase price (USD)', '', 'number'));
      const typeField = form.elements.type;
      const togglePartFields = () => { newPart.hidden = !['repair', 'upgrade'].includes(typeField.value); };
      typeField.addEventListener('change', togglePartFields);
      togglePartFields();
      extras.append(newPart);
      const schedule = workshopField('scheduleId', 'Linked maintenance schedule', log.scheduleId || '', 'text',
        Object.fromEntries([['', 'No schedule'], ...records.filter(record => record.kind === 'schedule').map(record => [record.id, record.title])]));
      const toggleSchedule = () => { schedule.hidden = typeField.value !== 'maintenance'; };
      typeField.addEventListener('change', toggleSchedule);
      toggleSchedule();
      form.append(extras, schedule, warrantyFields(log.warranty));
      for (const name of ['partsCost', 'laborCost', 'newPartPrice']) if (form.elements[name]) form.elements[name].step = '0.01';
      if (!log.id) form.append(workshopField('procedure', 'Start with a procedure (optional)', '', 'text',
        Object.fromEntries([['', 'No procedure'], ...records.filter(record => record.kind === 'procedure').map(record => [record.id, record.title])])));
    }, (data, form) => write('logs' + (log.id ? '/' + log.id : ''), log.id ? 'PUT' : 'POST',
      { ...log, ...data, cost: dollarsToCents(data.cost), revision: log.revision,
        expenses: { parts: dollarsToCents(data.partsCost), labor: dollarsToCents(data.laborCost), misc: dollarsToCents(data.cost) },
        partIds: new FormData(form).getAll('partIds'), warranty: readWarranty(data),
        scheduleId: data.type === 'maintenance' ? data.scheduleId : '',
        newPart: ['repair', 'upgrade'].includes(data.type) ? { title: data.newPart, brand: data.newPartBrand, number: data.newPartNumber, price: dollarsToCents(data.newPartPrice) } : null,
        steps: log.steps || (records.find(record => record.id === data.procedure)?.steps || []).map(step => ({ ...step, id: crypto.randomUUID() })) }));
  }

  function stepEditor(step, save) {
    edit(step.id ? 'Edit DIY step' : 'Add DIY step', form => {
      for (const [key, label, type] of [
        ['title', 'Short title', 'text'], ['instructions', 'Instructions', 'textarea'], ['tools', 'Tools', 'text'],
        ['materials', 'Materials', 'text'], ['torque', 'Torque specifications', 'text'], ['notes', 'Notes', 'textarea']
      ]) form.append(workshopField(key, label, step[key], type));
    }, data => save({ ...data, id: step.id || crypto.randomUUID() }));
  }

  function guideView(log) {
    const body = workshopNode('div');
    body.append(workshopNode('h2', log.title + ' · Work instructions'));
    for (const [index, step] of (log.steps || []).entries()) {
      body.append(workshopNode('h3', (index + 1) + '. ' + (step.title || 'Draft step')),
        workshopNode('p', step.instructions, 'notes'));
      for (const key of ['tools', 'materials', 'torque', 'notes']) {
        if (step[key]) body.append(workshopNode('p', key[0].toUpperCase() + key.slice(1) + ' · ' + step[key], 'notes'));
      }
      const photos = files.filter(file => file.target === 'step:' + log.id + ':' + step.id);
      for (const file of photos) {
        const image = workshopNode('img');
        image.src = url(file.id);
        image.alt = file.detail.caption || file.name;
        body.append(image);
      }
    }
    body.append(workshopButton('Close guide', () => viewer.close()));
    viewer.setAttribute('aria-label', 'Work instructions');
    viewer.replaceChildren(body);
    viewer.showModal();
  }

  function guide(log) {
    const area = workshopNode('details');
    const steps = log.steps || [];
    const save = (next, guideDraft = log.guideDraft) => write('logs/' + log.id, 'PUT', { ...log, steps: next, guideDraft });
    const reorder = (from, to, button) => run(button, async () => {
      const next = [...steps];
      next.splice(to, 0, next.splice(from, 1)[0]);
      await save(next); await refresh();
    });
    area.append(workshopNode('summary', 'DIY / Work Instructions' + (log.guideDraft ? ' · Draft' : '')),
      workshopButton('Add step', () => stepEditor({}, step => save([...steps, step], true))));
    if (steps.length) area.append(workshopButton('Read guide', () => guideView(log)),
      workshopButton(log.guideDraft ? 'Mark guide ready' : 'Save as draft', event => run(event.currentTarget, async () => {
        await save(steps, !log.guideDraft); await refresh();
      })),
      workshopButton('Save as procedure', () => edit('Save reusable procedure', form => {
        form.append(workshopField('title', 'Procedure name', log.title));
      }, data => write('records', 'POST', { ...data, kind: 'procedure', steps }))));
    let dragFrom;
    for (const [index, step] of steps.entries()) {
      const row = workshopNode('article', null, 'workshop-item');
      row.draggable = true;
      row.addEventListener('dragstart', event => { dragFrom = index; event.dataTransfer.setData('text/plain', String(index)); });
      row.addEventListener('dragover', event => event.preventDefault());
      row.addEventListener('drop', event => {
        event.preventDefault();
        if (Number.isInteger(dragFrom) && dragFrom !== index) reorder(dragFrom, index);
        dragFrom = undefined;
      });
      row.append(workshopNode('h3', (index + 1) + '. ' + (step.title || 'Draft step')),
        workshopNode('p', step.instructions, 'notes'),
        workshopButton('Edit step', () => stepEditor(step, next => save(steps.map(item => item.id === next.id ? next : item)))),
        workshopButton('Delete step', event => {
          if (confirm('Delete this step and its photos?')) run(event.currentTarget, async () => {
            await save(steps.filter(item => item.id !== step.id)); await refresh();
          });
        }));
      if (index > 0) row.append(workshopButton('Move step up', event => reorder(index, index - 1, event.currentTarget)));
      if (index < steps.length - 1) row.append(workshopButton('Move step down', event => reorder(index, index + 1, event.currentTarget)));
      row.append(attachments('step:' + log.id + ':' + step.id, { noCover: true }));
      area.append(row);
    }
    return area;
  }

  function showProcedures() {
    contents.append(workshopNode('h2', 'Reusable procedures'));
    const procedures = records.filter(record => record.kind === 'procedure');
    if (!procedures.length) contents.append(workshopNode('p', 'Save a DIY guide from a log to reuse its written steps.'));
    for (const procedure of procedures) {
      const row = workshopNode('article', null, 'workshop-item');
      const save = steps => write('records/' + procedure.id, 'PUT', { ...procedure, steps });
      row.append(workshopNode('h3', procedure.title),
        workshopButton('Edit name', () => edit('Edit procedure', form => form.append(workshopField('title', 'Procedure name', procedure.title)),
          data => write('records/' + procedure.id, 'PUT', { ...procedure, ...data }))),
        workshopButton('Add step', () => stepEditor({}, step => save([...(procedure.steps || []), step]))),
        workshopButton('Delete procedure', event => {
          if (confirm('Delete this reusable procedure? Existing logs retain their own steps.')) run(event.currentTarget, async () => {
            await write('records/' + procedure.id, 'DELETE'); await refresh();
          });
        }));
      for (const [index, step] of (procedure.steps || []).entries()) {
        const line = workshopNode('div', null, 'account-actions');
        line.append(workshopNode('span', (index + 1) + '. ' + (step.title || 'Draft step')),
          workshopButton('Edit step', () => stepEditor(step, next => save(procedure.steps.map(item => item.id === next.id ? next : item)))),
          workshopButton('Remove step', event => run(event.currentTarget, async () => {
            await save(procedure.steps.filter(item => item.id !== step.id)); await refresh();
          })));
        row.append(line);
      }
      contents.append(row);
    }
  }

  function logCard(log) {
    const card = workshopNode('article', null, 'workshop-item');
    const heading = workshopNode('h3', log.title);
    const cover = files.find(file => file.target === 'log:' + log.id && file.mime.startsWith('image/'));
    if (cover) {
      const img = workshopNode('img', null, 'workshop-log-cover');
      img.src = url(cover.id);
      img.alt = cover.detail.caption || '';
      img.loading = 'lazy';
      card.append(img);
    }
    card.append(workshopNode('span', logTypes[log.type], 'workshop-badge ' + log.type), heading,
      workshopNode('p', [shortDate(log.date), logStatuses[log.status], log.mileage == null ? '' : Number(log.mileage).toLocaleString() + ' mi', dollars(log.cost)].filter(Boolean).join(' · ')));
    if (log.expenses) card.append(workshopNode('p', 'Parts ' + dollars(log.expenses.parts) + ' · Labor ' +
      dollars(log.expenses.labor) + ' · Other ' + dollars(log.expenses.misc)));
    for (const part of records.filter(part => log.partIds?.includes(part.id))) card.append(workshopNode('p', 'Part · ' + part.title));
    if (log.notes) card.append(workshopNode('p', log.notes, 'notes'));
    const details = workshopNode('details');
    details.append(workshopNode('summary', 'Photos and actions'),
      attachments('log:' + log.id),
      workshopNode('h3', 'Receipts and documents'), attachments('receipt:' + log.id, { document: true }),
      warrantyView(log.warranty, 'warranty:' + log.id),
      workshopButton('Edit entry', () => logEditor(log)),
      workshopButton('Delete entry', event => {
        if (confirm('Delete this log entry and its attachments?')) run(event.currentTarget, async () => {
          await write('logs/' + log.id, 'DELETE'); await refresh();
        });
      }));
    card.append(details, guide(log));
    return card;
  }

  function showLogs() {
    const bar = workshopNode('div', null, 'workshop-toolbar');
    const list = workshopNode('div', null, 'workshop-list');
    const draw = () => {
      const selected = logs.filter(log => (!filter.type || filter.type === log.type) && (!filter.status || filter.status === log.status) &&
        (!filter.start || log.date >= filter.start) && (!filter.end || log.date <= filter.end) &&
        (log.title + ' ' + log.notes).toLowerCase().includes(filter.query.toLowerCase()));
      if (filter.sort === 'cost') selected.sort((a, b) => b.cost - a.cost);
      if (filter.sort === 'mileage') selected.sort((a, b) => (b.mileage ?? -1) - (a.mileage ?? -1));
      list.replaceChildren(...(selected.length ? selected.map(logCard) : [workshopNode('p', 'No activity entries match.')]));
    };
    for (const field of [
      workshopField('query', 'Search activity', filter.query, 'search'),
      workshopField('type', 'Type', filter.type, 'text', { '': 'All types', ...logTypes }),
      workshopField('status', 'Status', filter.status, 'text', { '': 'All statuses', ...logStatuses }),
      workshopField('start', 'From', filter.start, 'date'), workshopField('end', 'Through', filter.end, 'date'),
      workshopField('sort', 'Sort by', filter.sort, 'text', { date: 'Newest', mileage: 'Odometer', cost: 'Cost' })
    ]) {
      field.lastChild.addEventListener('input', event => { filter[event.target.name] = event.target.value; draw(); });
      bar.append(field);
    }
    contents.append(workshopButton('Add Log Entry', () => logEditor(), 'primary'), bar, list);
    draw();
  }

  function partEditor(part = {}) {
    edit(part.id ? 'Edit part' : 'Add part', form => {
      for (const [name, title, type] of [
        ['title', 'Part name', 'text'], ['brand', 'Manufacturer / brand', 'text'], ['number', 'Part number', 'text'],
        ['category', 'Category', 'text'], ['purchaseDate', 'Purchase date', 'date'], ['price', 'Purchase price (USD)', 'number'],
        ['retailer', 'Retailer', 'text'], ['url', 'Purchase URL', 'url'], ['installDate', 'Installation date', 'date'], ['notes', 'Notes', 'textarea']
      ]) form.append(workshopField(name, title, name === 'price' ? part.price == null ? '' : part.price / 100 : part[name], type));
      form.elements.title.required = true;
      form.elements.price.step = '0.01';
      form.append(workshopField('status', 'Status', part.status || 'planned', 'text', partStatuses), warrantyFields(part.warranty));
    }, data => write('records' + (part.id ? '/' + part.id : ''), part.id ? 'PUT' : 'POST',
      { ...part, ...data, kind: 'part', price: dollarsToCents(data.price), warranty: readWarranty(data) }));
  }

  function showParts() {
    const search = workshopField('partSearch', 'Search parts', partQuery, 'search');
    const list = workshopNode('div', null, 'workshop-list');
    const draw = () => {
      const items = records.filter(part => part.kind === 'part' && [part.title, part.brand, part.number, part.category, part.notes]
        .join(' ').toLowerCase().includes(partQuery.toLowerCase()));
      list.replaceChildren(...items.map(part => {
        const item = workshopNode('article', null, 'workshop-item');
        const state = partState(part, logs);
        item.append(workshopNode('h3', part.title), workshopNode('p', [partStatuses[state.status], part.brand, part.number, part.category,
          part.price == null ? '' : dollars(part.price), state.installDate ? 'Installed ' + shortDate(state.installDate) : ''].filter(Boolean).join(' · ')),
          workshopNode('p', part.notes, 'notes'));
        if (part.url) { const link = workshopNode('a', part.retailer || 'Purchase page'); link.href = part.url; link.rel = 'noopener noreferrer'; link.target = '_blank'; item.append(link); }
        else if (part.retailer) item.append(workshopNode('p', part.retailer));
        const details = workshopNode('details');
        details.append(workshopNode('summary', 'Photos and linked history'), attachments('part:' + part.id));
        for (const log of logs.filter(log => log.partIds?.includes(part.id))) details.append(workshopNode('p',
          shortDate(log.date) + ' · ' + log.title + (log.partAction ? ' · ' + partStatuses[log.partAction] : '')));
        item.append(details, warrantyView(part.warranty, 'part-warranty:' + part.id), workshopButton('Edit part', () => partEditor(part)), workshopButton('Delete part', event => {
          if (confirm('Delete this part? Set its status to Removed if you want to keep its history.')) run(event.currentTarget, async () => {
            await write('records/' + part.id, 'DELETE'); await refresh();
          });
        }));
        return item;
      }));
      if (!items.length) list.append(workshopNode('p', 'No parts match.'));
    };
    search.lastChild.addEventListener('input', event => { partQuery = event.target.value; draw(); });
    contents.append(workshopButton('Add part', () => partEditor(), 'primary'), search, list);
    draw();
  }

  function showExpenses() {
    const summary = expenseSummary(logs, records.filter(record => record.kind === 'part'));
    contents.append(workshopNode('h2', 'Recorded spending'), workshopNode('p', dollars(summary.total) + ' lifetime total'),
      workshopNode('p', 'Completed logs and purchased inventory are counted once. Receipts do not add duplicate costs.'));
    const bars = (title, rows) => {
      const panel = workshopNode('section', null, 'workshop-item');
      panel.append(workshopNode('h3', title));
      const max = Math.max(1, ...rows.map(([, amount]) => amount));
      for (const [label, amount] of rows) {
        const group = workshopNode('label', label + ' · ' + dollars(amount));
        const bar = workshopNode('progress');
        bar.max = max; bar.value = amount;
        group.append(bar); panel.append(group);
      }
      if (!rows.length) panel.append(workshopNode('p', 'No recorded costs.'));
      contents.append(panel);
    };
    bars('Spending by activity', Object.entries(summary.types).map(([key, value]) => [logTypes[key] || 'Inventory purchases', value]));
    bars('Spending by month', Object.entries(summary.months).sort(([a], [b]) => b.localeCompare(a)));
  }

  function warrantyFields(warranty = {}) {
    const area = workshopNode('details');
    area.append(workshopNode('summary', 'Warranty (optional)'),
      workshopField('warrantyProvider', 'Warranty provider', warranty.provider),
      workshopField('warrantyStart', 'Warranty start', warranty.start, 'date'),
      workshopField('warrantyExpires', 'Warranty expiration', warranty.expires, 'date'),
      workshopField('warrantyLimit', 'Warranty mileage limit', warranty.limit, 'number'));
    return area;
  }

  function readWarranty(data) {
    return { provider: data.warrantyProvider, start: data.warrantyStart, expires: data.warrantyExpires, limit: data.warrantyLimit };
  }

  function warrantyView(warranty, target) {
    const area = workshopNode('details');
    area.append(workshopNode('summary', 'Warranty and documents'));
    if (warranty) area.append(workshopNode('p', [
      warranty.provider, warranty.start && 'Started ' + shortDate(warranty.start), warranty.expires && 'Expires ' + shortDate(warranty.expires),
      warranty.limit == null ? '' : Number(warranty.limit).toLocaleString() + ' mi limit'
    ].filter(Boolean).join(' · ') || 'No warranty details.'));
    area.append(attachments(target, { document: true }));
    return area;
  }

  function saveRecord(kind, record, data) {
    return write('records' + (record.id ? '/' + record.id : ''), record.id ? 'PUT' : 'POST', { ...record, ...data, kind });
  }

  function removeRecord(record, label) {
    return workshopButton('Delete ' + label, event => {
      if (confirm('Delete this ' + label + '?')) run(event.currentTarget, async () => {
        await write('records/' + record.id, 'DELETE'); await refresh();
      });
    });
  }

  function scheduleEditor(schedule = {}) {
    edit(schedule.id ? 'Edit schedule' : 'Add schedule', form => {
      form.append(workshopField('title', 'Maintenance task', schedule.title),
        workshopField('intervalMiles', 'Repeat every (miles)', schedule.intervalMiles, 'number'),
        workshopField('months', 'Repeat every (months)', schedule.months, 'number'),
        workshopField('lastDate', 'Last completed date', schedule.lastDate, 'date'),
        workshopField('lastMileage', 'Last completed odometer', schedule.lastMileage, 'number'),
        workshopField('notes', 'Notes', schedule.notes, 'textarea'));
      form.elements.title.required = true;
    }, data => saveRecord('schedule', schedule, data));
  }

  function serviceState(schedule) {
    const info = records.find(record => record.kind === 'spec');
    return nextService(schedule, logs, info?.mileage, new Date().toISOString().slice(0, 10));
  }

  function showSchedule() {
    const schedules = records.filter(record => record.kind === 'schedule');
    contents.append(workshopButton('Add schedule', () => scheduleEditor(), 'primary'));
    if (!schedules.length) contents.append(workshopNode('p', 'No maintenance schedules yet.'));
    for (const schedule of schedules) {
      const row = workshopNode('article', null, 'workshop-item');
      const due = serviceState(schedule);
      row.append(workshopNode('h3', schedule.title), workshopNode('span', due.state, 'workshop-badge'),
        workshopNode('p', [due.dueDate && 'Due ' + shortDate(due.dueDate),
          due.dueMileage == null ? '' : 'Due at ' + due.dueMileage.toLocaleString() + ' mi',
          due.mileageUnknown ? 'Current odometer unknown' : ''].filter(Boolean).join(' · ')),
        workshopNode('p', schedule.notes, 'notes'),
        workshopButton('Log maintenance', () => logEditor({ title: schedule.title, type: 'maintenance', scheduleId: schedule.id })),
        workshopButton('Edit schedule', () => scheduleEditor(schedule)), removeRecord(schedule, 'schedule'));
      contents.append(row);
    }
  }

  function projectEditor(project = {}) {
    edit(project.id ? 'Edit project' : 'Add project', form => {
      form.append(workshopField('title', 'Project title', project.title),
        workshopField('status', 'Status', project.status || 'planned', 'text', logStatuses),
        workshopField('description', 'Description', project.description, 'textarea'),
        workshopField('budget', 'Estimated budget (USD)', project.budget == null ? '' : project.budget / 100, 'number'),
        workshopField('tasks', 'Planned tasks (one per line)', (project.tasks || []).map(task => task.title).join('
'), 'textarea'),
        workshopField('notes', 'Progress notes', project.notes, 'textarea'));
      form.elements.title.required = true;
      form.elements.budget.step = '0.01';
      for (const [field, label, items] of [
        ['logIds', 'Associated activity', logs], ['partIds', 'Parts needed', records.filter(record => record.kind === 'part')]
      ]) {
        const group = workshopNode('details');
        group.append(workshopNode('summary', label));
        for (const item of items) {
          const box = workshopNode('input');
          box.type = 'checkbox'; box.name = field; box.value = item.id; box.checked = project[field]?.includes(item.id) || false;
          const line = workshopNode('label', item.title);
          line.append(box); group.append(line);
        }
        form.append(group);
      }
    }, (data, form) => saveRecord('project', project, {
      ...data, budget: dollarsToCents(data.budget),
      tasks: data.tasks.split('
').filter(title => title.trim()).map(title => ({ title, done: project.tasks?.some(task => task.title === title && task.done) })),
      logIds: new FormData(form).getAll('logIds'), partIds: new FormData(form).getAll('partIds')
    }));
  }

  function showProjects() {
    const projects = records.filter(record => record.kind === 'project');
    contents.append(workshopButton('Add project', () => projectEditor(), 'primary'));
    if (!projects.length) contents.append(workshopNode('p', 'No projects yet.'));
    for (const project of projects) {
      const row = workshopNode('article', null, 'workshop-item');
      const linkedLogs = logs.filter(log => project.logIds?.includes(log.id));
      const partIds = new Set([...(project.partIds || []), ...linkedLogs.flatMap(log => log.partIds || [])]);
      const parts = records.filter(record => record.kind === 'part' && partIds.has(record.id));
      const summary = expenseSummary(linkedLogs, parts);
      row.append(workshopNode('h3', project.title), workshopNode('p', logStatuses[project.status] + ' · Actual ' + dollars(summary.total) +
        (project.budget == null ? '' : ' · Budget ' + dollars(project.budget))),
        workshopNode('p', project.description, 'notes'), workshopNode('p', project.notes, 'notes'));
      for (const [index, task] of (project.tasks || []).entries()) {
        const label = workshopNode('label', task.title);
        const check = workshopNode('input');
        check.type = 'checkbox'; check.checked = task.done;
        check.addEventListener('change', () => run(check, async () => {
          await saveRecord('project', project, { tasks: project.tasks.map((item, i) => i === index ? { ...item, done: check.checked } : item) });
          await refresh();
        }));
        label.append(check); row.append(label);
      }
      for (const log of linkedLogs) row.append(workshopNode('p', 'Activity · ' + log.title));
      for (const part of parts) row.append(workshopNode('p', 'Part · ' + part.title));
      const photos = workshopNode('details');
      photos.append(workshopNode('summary', 'Project photos'), attachments('project:' + project.id));
      row.append(photos, workshopButton('Edit project', () => projectEditor(project)), removeRecord(project, 'project'));
      contents.append(row);
    }
  }

  function render() {
    status.textContent = '';
    contents.replaceChildren();
    actions.replaceChildren(...Object.entries({ activity: 'Vehicle Log', photos: 'Photos', procedures: 'Procedures', parts: 'Parts & Modifications', expenses: 'Spending', schedule: 'Maintenance Schedule', projects: 'Projects' }).map(([id, label]) =>
      workshopButton(label, () => { tab = id; render(); }, tab === id ? 'primary' : 'secondary')));
    if (tab === 'photos') contents.append(workshopNode('h2', 'Vehicle photos'), attachments('vehicle'));
    else if (tab === 'procedures') showProcedures();
    else if (tab === 'parts') showParts();
    else if (tab === 'expenses') showExpenses();
    else if (tab === 'schedule') showSchedule();
    else if (tab === 'projects') showProjects();
    else showLogs();
  }

  refresh().catch(error => { if (!disposed) status.textContent = error.message; });
}
