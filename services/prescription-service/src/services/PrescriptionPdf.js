import PDFDocument from 'pdfkit';

const MARGIN = 50;
// The app's primary green (UI guidelines: oklch(0.54 0.135 160)), as in the SOAP note PDF.
const GREEN = '#00835a';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const MINT = { fill: '#e2f5ec', text: '#1d5a40' };

const GENDER = { male: 'Male', female: 'Female', other: 'Other' };

// Medicines table columns: [title, share of the page width].
const COLUMNS = [
  ['Medicine', 0.3],
  ['Dose', 0.15],
  ['How often', 0.17],
  ['How long', 0.14],
  ['Instructions', 0.24],
];
const CELL_PAD = 7;
const HEADER_HEIGHT = 22;
const AI_TAG = 'AI suggestion, accepted';

// A TIMESTAMP as a long date, like "7 October 2026" (UTC, the same as the SOAP note PDF).
const toLongDate = (date) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Builds the prescription PDF in memory (design doc Diagram 8). The text is in Roman letters, so the
// built-in Helvetica font is used. Lines from an accepted AI suggestion are marked.
export class PrescriptionPdf {
  async build({ doctorName, patient, date, items, notes }) {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: 'Prescription' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.#header(doc);
    this.#details(doc, { doctorName, patient, date });
    this.#heading(doc, 'Medicines');
    this.#table(doc, items);
    if (items.some((item) => item.source === 'ai_accepted')) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor(MUTED)
        .text(`"${AI_TAG}": suggested by MediAssist AI and accepted by the doctor.`, MARGIN, doc.y, {
          width: this.#width(doc),
        });
      doc.moveDown(1);
    }
    if (notes?.trim()) {
      this.#heading(doc, 'Notes');
      doc.font('Helvetica').fontSize(11).fillColor(TEXT).text(notes, MARGIN, doc.y, { width: this.#width(doc), lineGap: 3 });
    }

    this.#pageNumbers(doc);
    doc.end();
    return done;
  }

  #header(doc) {
    doc.font('Helvetica-Bold').fontSize(20).fillColor(GREEN).text('MediAssist AI');
    doc.font('Helvetica').fontSize(12).fillColor(MUTED).text('Prescription');
    this.#rule(doc);
  }

  #details(doc, { doctorName, patient, date }) {
    const rows = [
      ['Doctor', doctorName || '-'],
      ['Patient', patient.name],
      ['Age', `${patient.age} years`],
      ['Gender', GENDER[patient.gender] ?? patient.gender],
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

  #heading(doc, title) {
    // Keep the heading with its first lines: start a new page when little room is left.
    this.#ensureRoom(doc, 80);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN).text(title, MARGIN, doc.y, { width: this.#width(doc) });
    doc.moveDown(0.3);
  }

  #table(doc, items) {
    const width = this.#width(doc);
    const columns = COLUMNS.map(([title, share]) => ({ title, width: Math.floor(width * share) }));
    columns.at(-1).width = width - columns.slice(0, -1).reduce((sum, c) => sum + c.width, 0);
    const inner = (i) => columns[i].width - CELL_PAD * 2;
    const cells = (item) => [item.dose, item.frequency, item.duration, item.instructions];

    const drawHeader = () => {
      const y = doc.y;
      doc.roundedRect(MARGIN, y, width, HEADER_HEIGHT, 5).fill(MINT.fill);
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MINT.text);
      for (const column of columns) {
        doc.text(column.title.toUpperCase(), x + CELL_PAD, y + 7, { width: column.width - CELL_PAD * 2, lineBreak: false });
        x += column.width;
      }
      doc.y = y + HEADER_HEIGHT;
    };

    // Height of one row: the medicine cell (name, generic name, AI tag) or the tallest other cell.
    const rowHeight = (item) => {
      let first = doc.font('Helvetica-Bold').fontSize(10).heightOfString(item.medicineName, { width: inner(0) });
      if (item.genericName && item.genericName !== item.medicineName) {
        first += 2 + doc.font('Helvetica').fontSize(9).heightOfString(item.genericName, { width: inner(0) });
      }
      if (item.source === 'ai_accepted') {
        first += 4 + doc.font('Helvetica-Bold').fontSize(8).heightOfString(AI_TAG, { width: inner(0) });
      }
      const others = cells(item).map((value, i) =>
        doc.font('Helvetica').fontSize(10).heightOfString(value ?? '-', { width: inner(i + 1) }),
      );
      return Math.max(first, ...others) + CELL_PAD * 2;
    };

    this.#ensureRoom(doc, HEADER_HEIGHT + rowHeight(items[0]));
    drawHeader();

    for (const item of items) {
      const height = rowHeight(item);
      if (doc.y + height > this.#bottom(doc)) {
        doc.addPage();
        drawHeader();
      }
      const top = doc.y;

      // Medicine cell.
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(item.medicineName, MARGIN + CELL_PAD, top + CELL_PAD, { width: inner(0) });
      if (item.genericName && item.genericName !== item.medicineName) {
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(item.genericName, MARGIN + CELL_PAD, doc.y, { width: inner(0) });
      }
      if (item.source === 'ai_accepted') {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(GREEN).text(AI_TAG, MARGIN + CELL_PAD, doc.y, { width: inner(0) });
      }

      // Dose, how often, how long, instructions.
      let x = MARGIN + columns[0].width;
      cells(item).forEach((value, i) => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(value ? TEXT : MUTED)
          .text(value ?? '-', x + CELL_PAD, top + CELL_PAD, { width: inner(i + 1) });
        x += columns[i + 1].width;
      });

      const bottom = top + height;
      doc.moveTo(MARGIN, bottom).lineTo(MARGIN + width, bottom).strokeColor(LINE).lineWidth(0.75).stroke();
      doc.x = MARGIN;
      doc.y = bottom;
    }
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

  // Starts a new page when less than `height` points are left above the bottom margin.
  #ensureRoom(doc, height) {
    if (doc.y + height > this.#bottom(doc)) doc.addPage();
  }

  #bottom(doc) {
    return doc.page.height - doc.page.margins.bottom;
  }

  #width(doc) {
    return doc.page.width - MARGIN * 2;
  }
}
