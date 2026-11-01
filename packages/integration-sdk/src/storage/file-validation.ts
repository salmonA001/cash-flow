export interface FilePolicy {
  maxBytes: number;
  allowedTypes: Record<string, { extensions: string[]; magic?: number[][] }>;
}

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPG = [0xff, 0xd8, 0xff];
const PDF = [0x25, 0x50, 0x44, 0x46];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

export const DESIGN_FILE_POLICY: FilePolicy = {
  maxBytes: 100 * 1024 * 1024,
  allowedTypes: {
    'image/png': { extensions: ['.png'], magic: [PNG] },
    'image/jpeg': { extensions: ['.jpg', '.jpeg'], magic: [JPG] },
    'image/svg+xml': { extensions: ['.svg'] },
    'application/pdf': { extensions: ['.pdf'], magic: [PDF] },
  },
};

export const DIGITAL_FILE_POLICY: FilePolicy = {
  maxBytes: 500 * 1024 * 1024,
  allowedTypes: {
    'application/zip': { extensions: ['.zip'], magic: [ZIP] },
    'application/pdf': { extensions: ['.pdf'], magic: [PDF] },
    'image/png': { extensions: ['.png'], magic: [PNG] },
    'image/jpeg': { extensions: ['.jpg', '.jpeg'], magic: [JPG] },
    'image/svg+xml': { extensions: ['.svg'] },
  },
};

export const CSV_FILE_POLICY: FilePolicy = {
  maxBytes: 20 * 1024 * 1024,
  allowedTypes: {
    'text/csv': { extensions: ['.csv'] },
    'application/vnd.ms-excel': { extensions: ['.csv'] },
  },
};

/** Validates declared type, extension, size and — where defined — magic bytes. Throws on failure. */
export function validateFile(file: { originalname: string; mimetype: string; size: number; buffer: Buffer }, policy: FilePolicy): void {
  if (file.size === 0) throw new Error('File is empty');
  if (file.size > policy.maxBytes) throw new Error(`File exceeds ${Math.round(policy.maxBytes / 1024 / 1024)} MB limit`);
  const rule = policy.allowedTypes[file.mimetype];
  if (!rule) throw new Error(`File type ${file.mimetype} is not allowed`);
  const ext = file.originalname.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  if (!rule.extensions.includes(ext)) throw new Error(`Extension ${ext || '(none)'} does not match ${file.mimetype}`);
  if (rule.magic && !rule.magic.some((sig) => sig.every((b, i) => file.buffer[i] === b))) {
    throw new Error('File content does not match its declared type');
  }
  if (file.mimetype === 'image/svg+xml' && /<script|on\w+\s*=|javascript:/i.test(file.buffer.toString('utf8'))) {
    throw new Error('SVG contains active content');
  }
}
