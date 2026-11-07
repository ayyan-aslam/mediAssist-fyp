import PDFDocument from 'pdfkit';

const MARGIN = 50;
// The app's primary green (UI guidelines: oklch(0.54 0.135 160)).
const GREEN = '#00835a';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

const PARTS = [
  ['subjective', 'Subjective'],
  ['objective', 'Objective'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
];

const GENDER = { male: 'Male', female: 'Female', other: 'Other' };

// A TIMESTAMP as a long date, like "7 October 2026" (UTC, the same day as the history list).
const toLongDate = (date) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Builds the SOAP note PDF in memory. The text is in Roman letters, so the built-in Helvetica font is used.
// pdfkit moves long text onto new pages by itself.
export class PdfGenerator {
  async createSoapNotePdf({ doctorName, patient, date, note }) {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: 'SOAP note' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.#header(doc);
    this.#details(doc, { doctorName, patient, date });
    for (const [part, title] of PARTS) this.#section(doc, title, note[part]);
    this.#pageNumbers(doc);

    doc.end();
    return done;
  }

  #header(doc) {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(GREEN).text('MediAssist AI');
    doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('SOAP note');
    this.#rule(doc);
  }

  #details(doc, { doctorName, patient, date }) {
    const rows = [
      ['Doctor', doctorName || '-'],
      ['Patient', patient.fullName],
      ['Age', `${patient.age} years`],
      ['Gender', GENDER[patient.gender] ?? patient.gender],
      ['Phone', patient.phone],
      ['Date', toLongDate(date)],
    ];
    doc.fontSize(11);
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font('Helvetica').fillColor(MUTED).text(label, MARGIN, y, { width: 80 });
      doc.font('Helvetica-Bold').fillColor(TEXT).text(value, MARGIN + 80, y, { width: this.#width(doc) - 80 });
      doc.moveDown(0.3);
    }
    this.#rule(doc);
  }

  #section(doc, title, text) {
    // Keep the heading with its first lines: start a new page when little room is left.
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN).text(title, MARGIN, doc.y, { width: this.#width(doc) });
    doc.moveDown(0.3);
    const body = text?.trim() ? text : 'Nothing written.';
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(text?.trim() ? TEXT : MUTED)
      .text(body, { width: this.#width(doc), lineGap: 3 });
    doc.moveDown(1);
  }

  #pageNumbers(doc) {
    const { start, count } = doc.bufferedPageRange();
    for (let i = start; i < start + count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      // Writing inside the bottom margin would add a page, so the margin is lifted for the footer.
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(MUTED)
        .text(`Page ${i + 1} of ${count}`, MARGIN, doc.page.height - 35, { width: this.#width(doc), align: 'center' });
      doc.page.margins.bottom = bottom;
    }
  }

  #rule(doc) {
    doc.moveDown(0.6);
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(doc.page.width - MARGIN, doc.y)
      .strokeColor(LINE)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.8);
  }

  #width(doc) {
    return doc.page.width - MARGIN * 2;
  }
}
