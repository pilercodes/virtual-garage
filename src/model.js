export const vehicles = [
  { id: 'corvette', year: 2003, make: 'Chevrolet', model: 'Corvette Z06', color: 'Silver' },
  { id: 'challenger', year: 2009, make: 'Dodge', model: 'Challenger SRT', color: 'Hemi Orange' },
  { id: 'corolla', year: 2012, make: 'Toyota', model: 'Corolla', color: '' }
];

function cleanText(value, max, required = false) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) return null;
  return value.trim();
}

export function cleanVehicle(input) {
  if (!input || typeof input !== 'object') return null;
  const { year } = input;
  const make = cleanText(input.make, 60, true);
  const model = cleanText(input.model, 80, true);
  const color = cleanText(input.color ?? '', 60);
  if (!Number.isInteger(year) || year < 1886 || year > new Date().getUTCFullYear() + 1 ||
      make === null || model === null || color === null) return null;
  return { year, make, model, color };
}

export function cleanService() {
  return null;
}
