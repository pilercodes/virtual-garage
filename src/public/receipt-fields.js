function validReceiptDate(year, month, day) {
  year = Number(year);
  if (year <= 99) year += year < 70 ? 2000 : 1900;
  const value = [year, String(Number(month)).padStart(2, '0'), String(Number(day)).padStart(2, '0')].join('-');
  const date = new Date(value + 'T00:00:00Z');
  return year >= 1900 && year <= 2099 && Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}

function receiptDate(line) {
  let match = /\b(19\d{2}|20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/.exec(line);
  if (match) return validReceiptDate(match[1], match[2], match[3]);
  match = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/.exec(line);
  if (match) return validReceiptDate(match[3], match[1], match[2]);
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  match = /\b([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(line);
  return match ? validReceiptDate(match[3], months.indexOf(match[1].toLowerCase().slice(0, 3)) + 1, match[2]) : '';
}

function trailingMoney(line) {
  const match = /(?:^|[\s:$])((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})\s*(?:USD)?\s*$/i.exec(line);
  if (!match || /-\s*\$?\s*[\d,.]+\s*$/.test(line)) return null;
  const cents = Math.round(Number(match[1].replaceAll(',', '')) * 100);
  return Number.isSafeInteger(cents) && cents <= 999999999 ? cents : null;
}

export function extractReceiptFields(text) {
  const lines = String(text || '').slice(0, 60000).split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const dates = lines.filter(line => !/\b(?:due|expiry|expires|return by|warranty)\b/i.test(line));
  const labeledDates = dates.filter(line => /(?:purchase|transaction|invoice|receipt|order)\s+date\b|^date\b/i.test(line));
  const date = [...labeledDates, ...dates.slice(0, 18)].map(receiptDate).find(Boolean) || '';
  const retailer = lines.slice(0, 10).find(line => /^[\p{L}][\p{L}\p{N}\s&.'’#/-]{2,69}$/u.test(line) &&
    !/\b(?:receipt|invoice|transaction|date|welcome|thank|order|customer|phone|copy|subtotal|total)\b/i.test(line)) || '';
  const totals = lines.flatMap((line, index) => {
    if (/\b(?:sub\s*total|tax|savings?|balance due|amount due|change|cash|tender|payment method|tip|refund|previous|discount|parts|labor|labour)\b/i.test(line)) return [];
    const priority = /\b(?:grand total|receipt total|invoice total|total paid|amount paid|total sale)\b/i.test(line) ? 2 :
      /^(?:total|sale total)\b/i.test(line) ? 1 : 0;
    const amount = trailingMoney(line);
    return priority && amount != null ? [{ amount, priority, index }] : [];
  }).sort((a, b) => b.priority - a.priority || b.index - a.index);
  const labeledAmount = label => lines.map(line => label.test(line) ? trailingMoney(line) : null).find(value => value != null) ?? null;
  const items = lines.filter(line => /\p{L}/u.test(line) && trailingMoney(line) != null &&
    !/\b(?:sub\s*total|total|tax|change|balance|payment|tender|cash|credit|debit|discount|paid|card|savings?|refund)\b/i.test(line)).slice(0, 10);
  return {
    retailer, date, total: totals[0]?.amount ?? null,
    parts: labeledAmount(/^(?:parts\s+(?:total|subtotal)|total\s+parts)\b/i),
    labor: labeledAmount(/^(?:labou?r\s+(?:total|subtotal)|total\s+labou?r|labou?r\s*:)/i),
    items
  };
}
