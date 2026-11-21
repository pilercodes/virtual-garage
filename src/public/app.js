import { mountWorkshop, mountGarageOverview, workshopFileUrl } from './workshop-ui.js';
import { setupGarageAccount } from './account-ui.js';
const byId = id => document.getElementById(id);
const vehicleList = byId('vehicles');
const garageStatus = byId('garage-status');
const dialog = byId('editor');
const form = byId('editor-form');
const submit = form.querySelector('[type=submit]');
let vehicles = [];
let saveEditor;
let viewing;
let authenticated = false;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

async function api(path, options = {}, garage = activeGarage) {
  const response = await fetch('/api/' + path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
      ...(!path.startsWith('account/') && garage ? { 'X-Garage': garage } : {})
    }
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.error || 'Request failed. Try again.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function setImage(node, vehicle) {
  delete node.dataset.car;
  node.replaceChildren();
  if (vehicle.photo) {
    const photo = element('img', 'vehicle-photo');
    photo.src = workshopFileUrl(vehicle.id, vehicle.photo, activeGarage);
    photo.alt = '';
    photo.loading = 'lazy';
    node.append(photo);
    return;
  }
  const imageVehicles = {
    corvette: [2003, 'Chevrolet', 'Corvette Z06', 'Silver'],
    challenger: [2009, 'Dodge', 'Challenger SRT', 'Hemi Orange'],
    corolla: [2012, 'Toyota', 'Corolla', '']
  };
  if (imageVehicles[vehicle.id]?.every((value, index) => value === [vehicle.year, vehicle.make, vehicle.model, vehicle.color][index])) {
    node.dataset.car = vehicle.id;
  }
}

function card(vehicle) {
  const link = element('a', 'card');
  link.href = '#vehicle/' + vehicle.id;
  const image = element('div', 'vehicle-image');
  image.setAttribute('aria-hidden', 'true');
  setImage(image, vehicle);
  const copy = element('div', 'card-copy');
  copy.append(element('p', 'eyebrow', vehicle.year + ' ' + vehicle.make),
    element('h2', '', vehicle.model), element('p', 'color', vehicle.color || 'Color unspecified'),
    element('span', 'view', 'View vehicle'));
  link.append(image, copy);
  return link;
}

function render(focus = false) {
  if (!authenticated) return;
  const id = location.hash.startsWith('#vehicle/') ? location.hash.slice(9) : '';
  viewing = vehicles.find(vehicle => vehicle.id === id);
  byId('garage').hidden = Boolean(viewing);
  byId('profile').hidden = !viewing;
  if (viewing) {
    byId('vehicle-action-status').textContent = '';
    byId('profile-title').textContent = viewing.model;
    byId('profile-make').textContent = viewing.year + ' ' + viewing.make;
    byId('profile-color').textContent = viewing.color || 'Color unspecified';
    setImage(byId('profile-image'), viewing);
    renderProfile(viewing);
    if (focus) byId('profile-title').focus();
  } else {
    byId('count').textContent = vehicles.length + ' ' + (vehicles.length === 1 ? 'vehicle' : 'vehicles');
    byId('profile-content').replaceChildren();
    vehicleList.replaceChildren(...vehicles.map(card));
    mountGarageOverview(byId('garage-overview'), vehicles, api);
    if (focus) byId('garage-title').focus();
  }
  if (focus) window.scrollTo(0, 0);
}

function renderProfile(vehicle) {
  const garage = activeGarage;
  mountWorkshop(byId('profile-content'), vehicle, activeGarage, (path, options) => api(path, options, garage), photo => {
    vehicle.photo = photo;
    if (viewing?.id === vehicle.id) setImage(byId('profile-image'), vehicle);
  });
}

function openEditor(title, template, button, save) {
  byId('editor-title').textContent = title;
  byId('form-error').textContent = '';
  byId('fields').replaceChildren(byId(template).content.cloneNode(true));
  submit.textContent = button;
  saveEditor = save;
  dialog.showModal();
}

function vehicleEditor(vehicle) {
  openEditor(vehicle ? 'Edit vehicle' : 'Add vehicle', 'vehicle-template', 'Save vehicle', async fields => {
    fields.year = Number(fields.year);
    const saved = await api('vehicles' + (vehicle ? '/' + vehicle.id : ''), {
      method: vehicle ? 'PUT' : 'POST', body: JSON.stringify(fields)
    });
    vehicles = vehicle ? vehicles.map(item => item.id === saved.id ? { ...item, ...saved } : item) : [...vehicles, saved];
    return () => {
      if (vehicle) render();
      else location.hash = 'vehicle/' + saved.id;
    };
  });
  const year = form.elements.namedItem('year');
  year.max = new Date().getUTCFullYear() + 1;
  for (const [key, value] of Object.entries(vehicle ?? {})) {
    const input = form.elements.namedItem(key);
    if (input) input.value = value;
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  byId('form-error').textContent = '';
  submit.disabled = true;
  try {
    const afterSave = await saveEditor(Object.fromEntries(new FormData(form)));
    dialog.close();
    afterSave();
  } catch (error) {
    byId('form-error').textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
dialog.addEventListener('cancel', event => {
  if (submit.disabled) event.preventDefault();
});
for (const button of dialog.querySelectorAll('.cancel, .close')) {
  button.addEventListener('click', () => {
    if (!submit.disabled) dialog.close();
  });
}
byId('add-vehicle').addEventListener('click', () => vehicleEditor());
byId('edit-vehicle').addEventListener('click', () => vehicleEditor(viewing));

let activeGarage;
let garageLoad = 0;

byId('delete-vehicle').addEventListener('click', async event => {
  const current = viewing;
  const garage = activeGarage;
  const button = event.currentTarget;
  const status = byId('vehicle-action-status');
  if (!current || !confirm('Delete ' + current.model + ' from the dashboard? You can restore it and its history from Removed vehicles.')) return;
  button.disabled = true;
  status.textContent = '';
  try {
    await api('vehicles/' + current.id, { method: 'DELETE' }, garage);
    if (activeGarage !== garage) return;
    if (viewing?.id === current.id) history.replaceState(null, '', '#garage');
    await loadGarage();
    if (activeGarage === garage && !viewing) byId('garage-title').focus();
  } catch (error) {
    if (activeGarage === garage && viewing?.id === current.id) status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function renderRemoved(removed) {
  const details = byId('removed-vehicles');
  const list = byId('removed-list');
  const garage = activeGarage;
  details.hidden = removed.length === 0;
  list.replaceChildren(...removed.map(vehicle => {
    const row = element('div', 'account-actions');
    const name = element('span', '', [vehicle.year, vehicle.make, vehicle.model].join(' '));
    const button = element('button', 'secondary', 'Restore vehicle');
    button.type = 'button';
    button.setAttribute('aria-label', 'Restore ' + vehicle.model);
    const status = element('span', '');
    status.setAttribute('role', 'status');
    row.append(name, button, status);
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = '';
      try {
        await api('vehicles/' + vehicle.id + '/restore', { method: 'POST' }, garage);
        if (activeGarage === garage) await loadGarage();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    return row;
  }));
}

async function loadGarage() {
  const load = ++garageLoad;
  byId('retry').hidden = true;
  garageStatus.hidden = false;
  garageStatus.textContent = 'Loading your garage…';
  try {
    const [list, removed] = await Promise.all([api('vehicles'), api('vehicles/removed')]);
    if (load !== garageLoad) return;
    vehicles = list;
    renderRemoved(removed);
    garageStatus.hidden = true;
    byId('add-vehicle').disabled = false;
    render();
  } catch (error) {
    if (load !== garageLoad) return;
    garageStatus.textContent = error.message;
    byId('retry').hidden = false;
  }
}

window.addEventListener('hashchange', () => render(true));
byId('retry').addEventListener('click', loadGarage);
await setupGarageAccount(api, async id => {
  activeGarage = id;
  authenticated = Boolean(id);
  garageLoad++;
  vehicles = [];
  viewing = undefined;
  vehicleList.replaceChildren();
  byId('garage-overview').replaceChildren();
  byId('removed-vehicles').open = false;
  renderRemoved([]);
  byId('profile').hidden = true;
  byId('profile-content').replaceChildren();
  byId('garage').hidden = !id;
  if (id) {
    garageStatus.hidden = false;
    byId('add-vehicle').disabled = true;
    await loadGarage();
  }
});
