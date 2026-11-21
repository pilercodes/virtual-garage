const byId = id => document.getElementById(id);
const vehicleList = byId('vehicles');
const garageStatus = byId('garage-status');
const dialog = byId('editor');
const form = byId('editor-form');
const submit = form.querySelector('[type=submit]');
let vehicles = [];
let saveEditor;
let viewing;

function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

async function api(path, options = {}) {
  const response = await fetch('/api/' + path, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error || 'Request failed. Try again.');
  }
  return response.json();
}

function setImage(node, vehicle) {
  delete node.dataset.car;
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
  const id = location.hash.startsWith('#vehicle/') ? location.hash.slice(9) : '';
  viewing = vehicles.find(vehicle => vehicle.id === id);
  byId('garage').hidden = Boolean(viewing);
  byId('profile').hidden = !viewing;
  if (viewing) {
    byId('profile-title').textContent = viewing.model;
    byId('profile-make').textContent = viewing.year + ' ' + viewing.make;
    byId('profile-color').textContent = viewing.color || 'Color unspecified';
    setImage(byId('profile-image'), viewing);
    renderProfile(viewing);
    if (focus) byId('profile-title').focus();
  } else {
    byId('count').textContent = vehicles.length + ' ' + (vehicles.length === 1 ? 'vehicle' : 'vehicles');
    vehicleList.replaceChildren(...vehicles.map(card));
    if (focus) byId('garage-title').focus();
  }
  if (focus) window.scrollTo(0, 0);
}

function renderProfile() {}

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
    vehicles = vehicle ? vehicles.map(item => item.id === saved.id ? saved : item) : [...vehicles, saved];
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

async function loadGarage() {
  byId('retry').hidden = true;
  garageStatus.textContent = 'Loading your garage…';
  try {
    vehicles = await api('vehicles');
    garageStatus.hidden = true;
    byId('add-vehicle').disabled = false;
    render();
  } catch (error) {
    garageStatus.textContent = error.message;
    byId('retry').hidden = false;
  }
}

window.addEventListener('hashchange', () => render(true));
byId('retry').addEventListener('click', loadGarage);
await loadGarage();
