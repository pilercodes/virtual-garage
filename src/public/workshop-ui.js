const logTypes = { maintenance: 'Maintenance', repair: 'Repair', upgrade: 'Upgrade / Modification', inspection: 'Inspection / Diagnosis' };
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
        workshopField('cost', 'Cost (USD)', log.cost == null ? '' : log.cost / 100, 'number'));
      form.elements.cost.step = '0.01';
      if (!log.id) form.append(workshopField('procedure', 'Start with a procedure (optional)', '', 'text',
        Object.fromEntries([['', 'No procedure'], ...records.filter(record => record.kind === 'procedure').map(record => [record.id, record.title])])));
    }, data => write('logs' + (log.id ? '/' + log.id : ''), log.id ? 'PUT' : 'POST',
      { ...log, ...data, cost: dollarsToCents(data.cost), revision: log.revision,
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
    if (log.notes) card.append(workshopNode('p', log.notes, 'notes'));
    const details = workshopNode('details');
    details.append(workshopNode('summary', 'Photos and actions'),
      attachments('log:' + log.id),
      workshopNode('h3', 'Receipts and documents'), attachments('receipt:' + log.id, { document: true }),
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

  function render() {
    status.textContent = '';
    contents.replaceChildren();
    actions.replaceChildren(...Object.entries({ activity: 'Vehicle Log', photos: 'Photos', procedures: 'Procedures' }).map(([id, label]) =>
      workshopButton(label, () => { tab = id; render(); }, tab === id ? 'primary' : 'secondary')));
    if (tab === 'photos') contents.append(workshopNode('h2', 'Vehicle photos'), attachments('vehicle'));
    else if (tab === 'procedures') showProcedures();
    else showLogs();
  }

  refresh().catch(error => { if (!disposed) status.textContent = error.message; });
}
