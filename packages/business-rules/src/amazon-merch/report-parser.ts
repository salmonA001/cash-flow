import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { MARKETPLACE_CURRENCY, MERCH_REPORT_FORMATS, MerchReportFormat } from './report-formats';

export interface NormalizedRoyaltyRow {
  rowNumber: number;
  transactionDate: string; // YYYY-MM-DD
  marketplace: string;
  asin: string;
  title: string | null;
  productType: string | null;
  unitsSold: number;
  unitsReturned: number;
  royaltyAmount: string;
  currency: string;
  rowHash: string;
}

export interface RowError {
  rowNumber: number;
  field: string;
  message: string;
}

export interface ParsedMerchReport {
  formatId: string;
  rows: NormalizedRoyaltyRow[];
  errors: RowError[];
  /** Rows identical to an earlier row in the same file (rowNumber list). */
  duplicateRowNumbers: number[];
}

export class UnsupportedReportFormatError extends Error {
  constructor(headers: string[]) {
    super(
      `Unrecognized Amazon Merch report headers: [${headers.join(', ')}]. ` +
        `Supported formats: ${MERCH_REPORT_FORMATS.map((f) => f.id).join(', ')}`,
    );
  }
}

export function detectFormat(headers: string[]): MerchReportFormat {
  const set = new Set(headers);
  const format = MERCH_REPORT_FORMATS.find((f) =>
    Object.values(f.columns).every((col) => col === undefined || set.has(col)),
  );
  if (!format) throw new UnsupportedReportFormatError(headers);
  return format;
}

function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : us ? [us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')] : [];
  if (!y) return null;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}` ? null : `${y}-${m}-${d}`;
}

function normalizeMoney(raw: string): string | null {
  const cleaned = raw.replace(/[,$£€¥\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number.isNaN(Number(cleaned)) ? null : cleaned;
}

function normalizeCount(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return 0;
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;
}

export function parseMerchReport(csv: string): ParsedMerchReport {
  const records: Record<string, string>[] = parse(csv, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  });
  if (records.length === 0) throw new Error('Report contains no data rows');
  const format = detectFormat(Object.keys(records[0]));
  const c = format.columns;

  const rows: NormalizedRoyaltyRow[] = [];
  const errors: RowError[] = [];
  const duplicateRowNumbers: number[] = [];
  const seen = new Set<string>();

  records.forEach((rec, idx) => {
    const rowNumber = idx + 2; // header is line 1
    const rowErrors: RowError[] = [];
    const err = (field: string, message: string) => rowErrors.push({ rowNumber, field, message });

    const transactionDate = normalizeDate(rec[c.date] ?? '');
    if (!transactionDate) err(c.date, `Invalid date "${rec[c.date]}"`);

    const asin = (rec[c.asin] ?? '').toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) err(c.asin, `Invalid ASIN "${rec[c.asin]}"`);

    const marketplace = (rec[c.marketplace] ?? '').toLowerCase().replace(/^www\./, '');
    if (!marketplace) err(c.marketplace, 'Marketplace is required');

    const royaltyAmount = normalizeMoney(rec[c.royalty] ?? '');
    if (royaltyAmount === null) err(c.royalty, `Invalid royalty amount "${rec[c.royalty]}"`);

    const unitsSold = normalizeCount(rec[c.unitsSold]);
    if (unitsSold === null) err(c.unitsSold, `Invalid unit count "${rec[c.unitsSold]}"`);
    const unitsReturned = c.unitsReturned ? normalizeCount(rec[c.unitsReturned]) : 0;
    if (unitsReturned === null) err(c.unitsReturned!, `Invalid return count "${rec[c.unitsReturned!]}"`);

    const currency = c.currency ? (rec[c.currency] ?? '').toUpperCase() : MARKETPLACE_CURRENCY[marketplace];
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      err(c.currency ?? c.marketplace, `Cannot determine currency for marketplace "${marketplace}"`);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    const normalized = {
      transactionDate: transactionDate!,
      marketplace,
      asin,
      unitsSold: unitsSold!,
      unitsReturned: unitsReturned!,
      royaltyAmount: royaltyAmount!,
      currency: currency!,
    };
    const rowHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    if (seen.has(rowHash)) {
      duplicateRowNumbers.push(rowNumber);
      return;
    }
    seen.add(rowHash);
    rows.push({
      ...normalized,
      rowNumber,
      title: c.title ? rec[c.title] || null : null,
      productType: c.productType ? rec[c.productType] || null : null,
      rowHash,
    });
  });

  return { formatId: format.id, rows, errors, duplicateRowNumbers };
}
