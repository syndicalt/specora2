import type { ImportRow } from "./types";
import { primitiveCellValue } from "./helpers";

function parseCsv(text: string): ImportRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  const headers = (rows.shift() || []).map((header) => header.trim()).filter(Boolean);
  return rows
    .filter((items) => items.some((item) => item.trim() !== ""))
    .map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index]?.trim() || ""])));
}

function parseJsonImport(text: string): ImportRow[] {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, primitiveCellValue(value)])));
}

function columnIndexFromRef(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(index - 1, 0);
}

async function inflateRaw(data: Uint8Array) {
  const Decompression = (globalThis as any).DecompressionStream;
  if (!Decompression) throw new Error("XLSX parsing requires a browser with decompression support.");
  const input = new Uint8Array(data.byteLength);
  input.set(data);
  const stream = new Blob([input.buffer]).stream().pipeThrough(new Decompression("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file.");
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  while (offset + 46 <= bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    entries.set(name, method === 0 ? data : method === 8 ? await inflateRaw(data) : new Uint8Array());
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function parseXlsxImport(file: File): Promise<ImportRow[]> {
  const entries = await unzipEntries(await file.arrayBuffer());
  const decoder = new TextDecoder();
  const xml = (path: string) => entries.has(path) ? new DOMParser().parseFromString(decoder.decode(entries.get(path)), "application/xml") : null;
  const sharedDoc = xml("xl/sharedStrings.xml");
  const sharedStrings = sharedDoc ? Array.from(sharedDoc.getElementsByTagName("si")).map((item) => Array.from(item.getElementsByTagName("t")).map((part) => part.textContent || "").join("")) : [];
  const sheetPath = entries.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : Array.from(entries.keys()).find((key) => key.startsWith("xl/worksheets/") && key.endsWith(".xml"));
  if (!sheetPath) throw new Error("No worksheet found in XLSX file.");
  const sheet = xml(sheetPath);
  if (!sheet) return [];
  const matrix: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName("row"))) {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const ref = cell.getAttribute("r") || "";
      const type = cell.getAttribute("t");
      const valueNode = cell.getElementsByTagName("v")[0];
      const inlineNode = cell.getElementsByTagName("t")[0];
      const raw = valueNode?.textContent || inlineNode?.textContent || "";
      values[columnIndexFromRef(ref)] = type === "s" ? sharedStrings[Number(raw)] || "" : raw;
    }
    if (values.some((value) => value)) matrix.push(values);
  }
  const headers = (matrix.shift() || []).map((header) => String(header || "").trim()).filter(Boolean);
  return matrix.map((items) => Object.fromEntries(headers.map((header, index) => [header, primitiveCellValue(items[index])])));
}

export async function parseImportFile(file: File) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) return parseJsonImport(await file.text());
  if (name.endsWith(".xlsx")) return parseXlsxImport(file);
  return parseCsv(await file.text());
}
