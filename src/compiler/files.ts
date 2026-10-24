/** A rules or card-list file, prepared for sending to Claude. */
export type SourceFile =
  | { name: string; kind: 'pdf'; base64: string }
  | { name: string; kind: 'text'; text: string };

const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.yaml', '.yml'];
const MAX_BYTES = 30 * 1024 * 1024; // the API accepts requests up to 32 MB

export class UnsupportedFileError extends Error {}

/** Reads a PDF, Word (.docx) or text file from the browser's file picker. */
export async function readSourceFile(file: File): Promise<SourceFile> {
  const name = file.name;
  const lower = name.toLowerCase();
  if (file.size > MAX_BYTES) throw new UnsupportedFileError(`${name} is larger than 30 MB`);
  if (lower.endsWith('.pdf')) {
    return { name, kind: 'pdf', base64: toBase64(new Uint8Array(await file.arrayBuffer())) };
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { name, kind: 'text', text: value };
  }
  if (lower.endsWith('.xlsx')) {
    const { default: readExcelFile } = await import('read-excel-file/universal');
    return { name, kind: 'text', text: spreadsheetToText(await readExcelFile(await file.arrayBuffer())) };
  }
  if (lower.endsWith('.xls') || lower.endsWith('.numbers')) {
    throw new UnsupportedFileError(`${name}: save the spreadsheet as .xlsx or CSV first`);
  }
  if (lower.endsWith('.doc')) throw new UnsupportedFileError(`${name}: old .doc files aren't supported; save it as .docx or PDF`);
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || file.type.startsWith('text/')) {
    return { name, kind: 'text', text: await file.text() };
  }
  throw new UnsupportedFileError(`${name}: use a PDF, Word (.docx), Excel (.xlsx), text or CSV file`);
}

/** Turns spreadsheet sheets into CSV text, one block per non-empty sheet, labelled with its name when there are several. */
export function spreadsheetToText(sheets: { sheet: string; data: readonly (readonly unknown[])[] }[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blocks = sheets
    .map((s) => ({ name: s.sheet, rows: s.data.filter((row) => row.some((v) => v !== null && v !== undefined && v !== '')) }))
    .filter((s) => s.rows.length > 0)
    .map((s) => ({ name: s.name, csv: s.rows.map((row) => row.map(cell).join(',')).join('\n') }));
  if (blocks.length === 1) return blocks[0].csv + '\n';
  return blocks.map((b) => `Sheet: ${b.name}\n${b.csv}\n`).join('\n');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
