import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VerificationResult } from '../../shared-types/src/index.js';

const CITATION_RE = /\[src:([^\]]+)\]/g;
const PARAMETRIC_RE = /\[parametric:(high|low)\]/g;
const WATERMARK_TEXT = '\uacb0\uc7ac \ubd80\uc801\ud569 - \uac80\ud1a0\uc6a9';

export interface RenderDocxInput {
  text: string;
  outputPath: string;
  citationStyle?: 'footnote' | 'endnote' | 'inline';
  verification?: VerificationResult;
}

export interface RenderDocxResult {
  outputPath: string;
  citation_count: number;
  watermark: boolean;
  stripped_parametric_tags: number;
}

export function renderVelugaDocx(input: RenderDocxInput): RenderDocxResult {
  const citationStyle = input.citationStyle ?? 'footnote';
  const sourceText = input.verification?.modified_text ?? input.text;
  const strippedParametricTags = [...sourceText.matchAll(PARAMETRIC_RE)].length;
  const watermark = strippedParametricTags > 0;
  const citations: string[] = [];
  let citationIndex = 0;
  const bodyText = sourceText
    .replace(PARAMETRIC_RE, '')
    .replace(CITATION_RE, (tag, source: string) => {
      citations.push(source);
      citationIndex += 1;
      return citationStyle === 'inline'
        ? `[${citationIndex}]`
        : `[[VELUGA_${citationStyle.toUpperCase()}_${citationIndex}]]`;
    });

  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypes(citationStyle),
    '_rels/.rels': rootRels(),
    'word/_rels/document.xml.rels': documentRels(citationStyle),
    'word/document.xml': documentXml(bodyText, citations, citationStyle, watermark),
    'word/styles.xml': stylesXml()
  };
  if (citationStyle === 'footnote') {
    files['word/footnotes.xml'] = notesXml('footnote', citations);
  }
  if (citationStyle === 'endnote') {
    files['word/endnotes.xml'] = notesXml('endnote', citations);
  }

  mkdirSync(path.dirname(input.outputPath), { recursive: true });
  writeFileSync(input.outputPath, createZip(files));
  return {
    outputPath: input.outputPath,
    citation_count: citations.length,
    watermark,
    stripped_parametric_tags: strippedParametricTags
  };
}

function documentXml(text: string, citations: string[], style: 'footnote' | 'endnote' | 'inline', watermark: boolean): string {
  const paragraphs = splitParagraphs(text).map((paragraph) => paragraphXml(paragraph, style));
  const watermarkParagraph = watermark
    ? `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="B7B7B7"/><w:sz w:val="56"/></w:rPr><w:t>${escapeXml(WATERMARK_TEXT)}</w:t></w:r></w:p>`
    : '';
  const inlineRefs =
    style === 'inline' && citations.length
      ? `<w:p><w:r><w:t>References: ${escapeXml(citations.map((citation, index) => `[${index + 1}] ${citation}`).join('; '))}</w:t></w:r></w:p>`
      : '';
  return xml(`<!-- veluga-watermark:${watermark ? WATERMARK_TEXT : 'none'} -->${watermarkParagraph}${paragraphs.join('')}${inlineRefs}`);
}

function paragraphXml(paragraph: string, style: 'footnote' | 'endnote' | 'inline'): string {
  const parts = paragraph.split(/(\[\[VELUGA_(?:FOOTNOTE|ENDNOTE)_\d+\]\])/g).filter(Boolean);
  const runs = parts
    .map((part) => {
      const ref = part.match(/^\[\[VELUGA_(FOOTNOTE|ENDNOTE)_(\d+)\]\]$/);
      if (!ref) {
        return `<w:r><w:t xml:space="preserve">${escapeXml(part)}</w:t></w:r>`;
      }
      const type = ref[1] === 'FOOTNOTE' ? 'footnote' : 'endnote';
      return `<w:r><w:${type}Reference w:id="${Number(ref[2]) + 1}"/></w:r>`;
    })
    .join('');
  return `<w:p>${runs}</w:p>`;
}

function notesXml(kind: 'footnote' | 'endnote', citations: string[]): string {
  const root = kind === 'footnote' ? 'w:footnotes' : 'w:endnotes';
  const entries = citations
    .map(
      (citation, index) =>
        `<w:${kind} w:id="${index + 2}"><w:p><w:r><w:t>${escapeXml(citation)}</w:t></w:r></w:p></w:${kind}>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${entries}</${root}>`;
}

function contentTypes(style: 'footnote' | 'endnote' | 'inline'): string {
  const noteOverride =
    style === 'footnote'
      ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
      : style === 'endnote'
        ? '<Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>'
        : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${noteOverride}</Types>`;
}

function rootRels(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
}

function documentRels(style: 'footnote' | 'endnote' | 'inline'): string {
  const noteRel =
    style === 'footnote'
      ? '<Relationship Id="rIdFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
      : style === 'endnote'
        ? '<Relationship Id="rIdEndnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>'
        : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${noteRel}</Relationships>`;
}

function stylesXml(): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createZip(files: Record<string, string>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuffer, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuffer.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});
