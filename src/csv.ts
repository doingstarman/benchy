// Minimal RFC-4180 CSV parser: quoted fields, escaped "" quotes, and commas /
// newlines inside quotes. Returns rows of string cells; fully-empty lines are
// dropped so a trailing newline doesn't add a blank item.
export function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let started = false // did this row have any content (so we can drop blank lines)

  const endField = () => { row.push(field); field = ''; started = true }
  const endRow = () => {
    endField()
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    started = false
  }

  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') { inQuotes = true; started = true }
    else if (c === ',') endField()
    else if (c === '\n') endRow()
    else { field += c; started = true }
  }
  if (started || field !== '' || row.length) endRow()
  return rows
}
