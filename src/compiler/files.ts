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
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.numbers')) {
    throw new UnsupportedFileError(`${name}: spreadsheets need to be saved as CSV first (File → Save as / Download → CSV)`);
  }
  if (lower.endsWith('.doc')) throw new UnsupportedFileError(`${name}: old .doc files aren't supported; save it as .docx or PDF`);
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext)) || file.type.startsWith('text/')) {
    return { name, kind: 'text', text: await file.text() };
  }
  throw new UnsupportedFileError(`${name}: use a PDF, Word (.docx), text or CSV file`);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
