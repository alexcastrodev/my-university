import { deflateSync } from 'node:zlib';

interface PdfOptions {
  /** Extra text placed inside the catalog dictionary, e.g. `/OpenAction [3 0 R /Fit]`. */
  catalog?: string;
  /** Extra text inside the trailer dictionary, e.g. `/Encrypt 9 0 R`. */
  trailer?: string;
  /** Whole extra objects, appended after the page. */
  objects?: string[];
  /** Filler comment bytes, to reach a size. */
  padding?: number;
  /** The bytes of an object stream: `[dictionary entries, data]`. */
  objectStream?: [string, Buffer];
}

/** A small, well-formed PDF with a real cross-reference table. Everything the scanner reads can be varied. */
export function makePdf(options: PdfOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const add = (data: string | Buffer) => {
    const buf = typeof data === 'string' ? Buffer.from(data, 'latin1') : data;
    parts.push(buf);
    length += buf.length;
  };
  const object = (n: number, body: string | Buffer) => {
    offsets[n] = length;
    add(`${n} 0 obj\n`);
    add(body);
    add('\nendobj\n');
  };

  add('%PDF-1.4\n');
  if (options.padding) {
    add(`%${'x'.repeat(options.padding)}\n`);
  }
  object(1, `<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ''} >>`);
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>');
  let next = 4;
  for (const body of options.objects ?? []) object(next++, body);
  if (options.objectStream) {
    const [entries, data] = options.objectStream;
    object(
      next++,
      Buffer.concat([
        Buffer.from(
          `<< /Type /ObjStm /N 1 /First 6 ${entries} /Length ${data.length} >>\nstream\n`,
          'latin1',
        ),
        data,
        Buffer.from('\nendstream', 'latin1'),
      ]),
    );
  }

  const xref = length;
  add(`xref\n0 ${next}\n0000000000 65535 f \n`);
  for (let n = 1; n < next; n++) {
    add(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  }
  add(
    `trailer\n<< /Size ${next} /Root 1 0 R ${options.trailer ?? ''} >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return Buffer.concat(parts);
}

/** An object stream whose compressed content is `text` (what a real PDF writer would produce). */
export const deflated = (text: string): [string, Buffer] => [
  '/Filter /FlateDecode',
  deflateSync(Buffer.from(`5 0 ${text}`, 'latin1')),
];
