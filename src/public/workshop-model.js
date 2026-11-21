export function expenseSummary(logs, parts) {
  const types = {};
  const months = {};
  const includedParts = new Set();
  let total = 0;
  function add(cents, type, date) {
    if (!cents) return;
    total += cents;
    types[type] = (types[type] || 0) + cents;
    if (date) months[date.slice(0, 7)] = (months[date.slice(0, 7)] || 0) + cents;
  }
  for (const log of [...logs].filter(log => log.status === 'completed').sort((a, b) => a.date.localeCompare(b.date))) {
    add(log.cost, log.type, log.date);
    for (const id of log.partIds || []) {
      if (includedParts.has(id)) continue;
      const part = parts.find(part => part.id === id);
      if (!part || part.price == null) continue;
      includedParts.add(id);
      add(part.price, log.type, part.purchaseDate || log.date);
    }
  }
  for (const part of parts) {
    if (!includedParts.has(part.id) && (part.purchaseDate || part.status !== 'planned')) add(part.price, 'parts', part.purchaseDate);
  }
  return { total, types, months };
}

export function partState(part, logs) {
  const matched = logs.filter(log => log.status === 'completed' && log.partAction && log.partIds?.includes(part.id));
  const log = [...matched].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))[0];
  return { status: log && (!part.installDate || log.date >= part.installDate) ? log.partAction : part.status,
    installDate: part.installDate || matched.find(entry => entry.partAction === 'installed')?.date || '' };
}

export function nextService(schedule, logs, currentMileage, today) {
  const latest = [...logs].filter(log => log.scheduleId === schedule.id && log.status === 'completed')
    .sort((a, b) => b.date.localeCompare(a.date) || (b.mileage ?? -1) - (a.mileage ?? -1))[0];
  const useLog = latest && latest.date >= (schedule.lastDate || '');
  const date = useLog ? latest.date : schedule.lastDate;
  const mileage = useLog ? latest.mileage : schedule.lastMileage;
  let dueDate = '';
  if (date && schedule.months) {
    const [year, month, day] = date.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + schedule.months, 1));
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
    dueDate = next.toISOString().slice(0, 10);
  }
  const dueMileage = mileage == null || !schedule.intervalMiles ? null : mileage + schedule.intervalMiles;
  const hasMileage = dueMileage != null && currentMileage != null && currentMileage !== '';
  const days = dueDate ? Math.round((+new Date(dueDate) - +new Date(today)) / 86400000) : Infinity;
  const miles = hasMileage ? dueMileage - Number(currentMileage) : Infinity;
  const state = days < 0 || miles < 0 ? 'Overdue' : days <= 30 || miles <= 500 ? 'Upcoming' :
    dueDate || hasMileage ? 'Scheduled' : 'Needs baseline';
  return { dueDate, dueMileage, state, mileageUnknown: dueMileage != null && !hasMileage };
}
