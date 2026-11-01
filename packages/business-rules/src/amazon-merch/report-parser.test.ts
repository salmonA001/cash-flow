import { describe, expect, it } from 'vitest';
import { parseMerchReport, UnsupportedReportFormatError } from './report-parser';

const header = 'Date,ASIN,Marketplace,Title,Product Type,Purchased,Returned,Royalties,Currency';

describe('parseMerchReport', () => {
  it('parses and normalizes a valid royalties export', () => {
    const csv = `${header}\n2026-05-01,B0ABCDEFGH,Amazon.com,Cat Tee,Standard T-Shirt,3,0,"$7.41",USD\n05/02/2026,B0ABCDEFGH,amazon.de,Cat Tee,Standard T-Shirt,1,1,0.00,eur\n`;
    const r = parseMerchReport(csv);
    expect(r.formatId).toBe('merch-royalties-v1');
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ transactionDate: '2026-05-01', marketplace: 'amazon.com', royaltyAmount: '7.41', currency: 'USD', unitsSold: 3, rowNumber: 2 });
    expect(r.rows[1]).toMatchObject({ transactionDate: '2026-05-02', currency: 'EUR', unitsReturned: 1 });
  });

  it('reports row-level validation errors without dropping valid rows', () => {
    const csv = `${header}\n2026-02-30,BADASIN,amazon.com,X,Y,1,0,abc,USD\n2026-05-01,B0ABCDEFGH,amazon.com,Cat,Tee,1,0,2.47,USD\n`;
    const r = parseMerchReport(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.field)).toEqual(['Date', 'ASIN', 'Royalties']);
    expect(r.errors[0].rowNumber).toBe(2);
  });

  it('flags in-file duplicates and produces stable row hashes', () => {
    const row = '2026-05-01,B0ABCDEFGH,amazon.com,Cat,Tee,1,0,2.47,USD';
    const r = parseMerchReport(`${header}\n${row}\n${row}\n`);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicateRowNumbers).toEqual([3]);
    expect(parseMerchReport(`${header}\n${row}\n`).rows[0].rowHash).toBe(r.rows[0].rowHash);
  });

  it('derives currency from marketplace for formats without a currency column', () => {
    const csv = 'Sale Date,ASIN,Marketplace,Title,Product,Units,Returns,Royalty\n2026-05-01,B0ABCDEFGH,amazon.co.uk,Cat,Tee,2,0,4.10\n';
    const r = parseMerchReport(csv);
    expect(r.formatId).toBe('merch-sales-v1');
    expect(r.rows[0].currency).toBe('GBP');
  });

  it('rejects unknown layouts with a descriptive error', () => {
    expect(() => parseMerchReport('foo,bar\n1,2\n')).toThrow(UnsupportedReportFormatError);
  });
});
