import PDFDocument from 'pdfkit';

const MARGIN = 50;
// The app's primary green (UI guidelines: oklch(0.54 0.135 160)).
const GREEN = '#00835a';
const TEXT = '#1f2937';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

// Light fill and text colour pairs, like the sky and mint colours of the app.
const TONES = {
  sky: { fill: '#e8eefb', text: '#2c4482' },
  mint: { fill: '#e2f5ec', text: '#1d5a40' },
};

const PARTS = {
  subjective: 'Subjective',
  objective: 'Objective',
  assessment: 'Assessment',
  plan: 'Plan',
};

const GENDER = { male: 'Male', female: 'Female', other: 'Other' };

const HISTORY_STATUS = { currently_taking: 'Taking now', stopped: 'Stopped', completed: 'Finished' };

// Prescription table columns: [title, share of the page width].
const COLUMNS = [
  ['Medicine', 0.43],
  ['Dose', 0.19],
  ['How often', 0.2],
  ['How long', 0.18],
];
const CELL_PAD = 8;

// A TIMESTAMP as a long date, like "7 October 2026" (UTC, the same day as the history list).
const toLongDate = (date) =>
  date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// Builds the SOAP note PDF in memory. The text is in Roman letters, so the built-in Helvetica font is used.
// pdfkit moves long text onto new pages by itself; the pills and the table check the room left themselves.
export class PdfGenerator {
  async createSoapNotePdf({ doctorName, patient, date, note, symptoms = [], medicationHistory = [], prescription = [] }) {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: 'SOAP note' } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    this.#header(doc);
    this.#details(doc, { doctorName, patient, date });

    this.#part(doc, 'subjective', note.subjective);
    const symptomNames = symptoms.map((s) => s.symptom).filter(Boolean);
    if (symptomNames.length > 0) {
      this.#heading(doc, 'Symptoms');
      this.#pills(doc, symptomNames.map(capitalise));
    }
    if (medicationHistory.length > 0) {
      this.#heading(doc, 'Medication history');
      this.#history(doc, medicationHistory);
    }
    this.#part(doc, 'objective', note.objective);
    this.#part(doc, 'assessment', note.assessment);
    this.#part(doc, 'plan', note.plan);
    const medicines = prescription.filter((m) => m.name || m.genericName);
    if (medicines.length > 0) {
      this.#heading(doc, 'Prescription');
      this.#prescriptionTable(doc, medicines);
    }

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

  #heading(doc, title) {
    // Keep the heading with its first lines: start a new page when little room is left.
    this.#ensureRoom(doc, 80);
    doc.font('Helvetica-Bold').fontSize(14).fillColor(GREEN).text(title, MARGIN, doc.y, { width: this.#width(doc) });
    doc.moveDown(0.3);
  }

  #part(doc, part, text) {
    this.#heading(doc, PARTS[part]);
    const body = text?.trim() ? text : 'Nothing written.';
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor(text?.trim() ? TEXT : MUTED)
      .text(body, MARGIN, doc.y, { width: this.#width(doc), lineGap: 3 });
    doc.moveDown(1);
  }

  // Rounded pills, wrapped onto new lines (and new pages) as needed.
  #pills(doc, labels) {
    const height = 18;
    const gap = 6;
    const right = doc.page.width - MARGIN;
    doc.font('Helvetica').fontSize(10);
    let x = MARGIN;
    let y = doc.y;
    for (const label of labels) {
      const width = Math.min(doc.widthOfString(label) + 18, this.#width(doc));
      if (x + width > right) {
        x = MARGIN;
        y += height + gap;
      }
      if (y + height > this.#bottom(doc)) {
        doc.addPage();
        x = MARGIN;
        y = doc.y;
      }
      doc.roundedRect(x, y, width, height, height / 2).fill(TONES.sky.fill);
      doc.fillColor(TONES.sky.text).text(label, x + 9, y + 4.5, { width: width - 18, lineBreak: false, ellipsis: true });
      x += width + gap;
    }
    doc.x = MARGIN;
    doc.y = y + height;
    doc.moveDown(1.2);
  }

  #history(doc, items) {
    for (const item of items) {
      const details = [item.condition, item.frequency, item.duration].filter(Boolean).join(' · ');
      const status = HISTORY_STATUS[item.status] ?? item.status;
      this.#ensureRoom(doc, 30);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor(TEXT)
        .text(item.medicineName || 'Unnamed medicine', MARGIN, doc.y, { width: this.#width(doc), continued: Boolean(details || status) });
      if (details || status) {
        doc
          .font('Helvetica')
          .fillColor(MUTED)
          .text(`${details ? `  ${details}` : ''}${status ? `  (${status})` : ''}`);
      }
      doc.moveDown(0.35);
    }
    doc.moveDown(0.8);
  }

  #prescriptionTable(doc, medicines) {
    const width = this.#width(doc);
    const columns = COLUMNS.map(([title, share]) => ({ title, width: Math.floor(width * share) }));
    columns.at(-1).width = width - columns.slice(0, -1).reduce((sum, c) => sum + c.width, 0);

    const drawHeader = () => {
      const y = doc.y;
      const height = 22;
      doc.roundedRect(MARGIN, y, width, height, 5).fill(TONES.mint.fill);
      let x = MARGIN;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(TONES.mint.text);
      for (const column of columns) {
        doc.text(column.title.toUpperCase(), x + CELL_PAD, y + 7, { width: column.width - CELL_PAD * 2, lineBreak: false });
        x += column.width;
      }
      doc.y = y + height;
    };

    const cells = (m) => [m.dose ?? m.strength, m.frequency, m.duration];

    // Height of one row: the medicine cell (name, generic name, instructions) or the tallest other cell.
    const rowHeight = (m) => {
      const inner = columns[0].width - CELL_PAD * 2;
      let first = doc.font('Helvetica-Bold').fontSize(10).heightOfString(m.name ?? m.genericName, { width: inner });
      if (m.genericName && m.genericName !== m.name) first += 2 + doc.font('Helvetica').fontSize(9).heightOfString(m.genericName, { width: inner });
      if (m.instructions) first += 4 + doc.font('Helvetica-Oblique').fontSize(9).heightOfString(m.instructions, { width: inner });
      const others = cells(m).map((value, i) =>
        doc.font('Helvetica').fontSize(10).heightOfString(value ?? '-', { width: columns[i + 1].width - CELL_PAD * 2 }),
      );
      return Math.max(first, ...others) + CELL_PAD * 2;
    };

    this.#ensureRoom(doc, 22 + rowHeight(medicines[0]));
    drawHeader();

    for (const m of medicines) {
      const height = rowHeight(m);
      if (doc.y + height > this.#bottom(doc)) {
        doc.addPage();
        drawHeader();
      }
      const top = doc.y;
      const inner = columns[0].width - CELL_PAD * 2;

      // Medicine cell.
      doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(m.name ?? m.genericName, MARGIN + CELL_PAD, top + CELL_PAD, { width: inner });
      if (m.genericName && m.genericName !== m.name) {
        doc.moveDown(0.15);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(m.genericName, MARGIN + CELL_PAD, doc.y, { width: inner });
      }
      if (m.instructions) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Oblique').fontSize(9).fillColor(TEXT).text(m.instructions, MARGIN + CELL_PAD, doc.y, { width: inner });
      }

      // Dose, how often, how long.
      let x = MARGIN + columns[0].width;
      cells(m).forEach((value, i) => {
        const column = columns[i + 1];
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(value ? TEXT : MUTED)
          .text(value ?? '-', x + CELL_PAD, top + CELL_PAD, { width: column.width - CELL_PAD * 2 });
        x += column.width;
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
