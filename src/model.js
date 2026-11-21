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

export function cleanService(input) {
  if (!input || typeof input !== 'object') return null;
  const description = cleanText(input.description, 120, true);
  const notes = cleanText(input.notes ?? '', 1000);
  const { date, mileage, cost } = input;
  const parsed = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
  if (!parsed || Number.isNaN(+parsed) || parsed.toISOString().slice(0, 10) !== date || date < '1886-01-01' ||
      !Number.isInteger(mileage) || mileage < 0 || mileage > 9999999 ||
      typeof cost !== 'string' || !/^\d{1,7}(?:\.\d{1,2})?$/.test(cost) ||
      description === null || notes === null) return null;
  const [dollars, cents = ''] = cost.split('.');
  return { description, date, mileage, costCents: Number(dollars) * 100 + Number(cents.padEnd(2, '0')), notes };
}
