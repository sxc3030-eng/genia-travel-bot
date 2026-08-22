/**
 * Minimal RFC 4180 CSV parser.
 *
 * Affiliate exports carry quoted fields containing commas ("Montreal, QC"),
 * escaped quotes, and CRLF line endings. Splitting on commas would corrupt
 * those rows silently — and a corrupted row here becomes a wrong revenue
 * figure, not a crash — so the quoting rules are handled properly.
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let fieldWasQuoted = false;

  // Strip a UTF-8 BOM: Excel-exported reports routinely start with one, and it
  // would otherwise become part of the first header name.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = '';
    fieldWasQuoted = false;
  };

  const endRow = () => {
    endField();
    // Skip blank trailing lines rather than emitting a one-empty-field row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.trim() === '') {
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
    } else if (char === ',') {
      endField();
    } else if (char === '\n') {
      endRow();
    } else if (char === '\r') {
      // Handled by the \n that follows in CRLF; a lone \r also ends the row.
      if (text[i + 1] !== '\n') endRow();
    } else {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** Parses into objects keyed by header, normalising header case and spacing. */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  if (rows.length === 0) return [];

  const headers = rows[0].map(normaliseHeader);

  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? '';
    });
    return record;
  });
}

export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
}
