// The email texts: plain text and simple HTML.

const escapeHtml = (value) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// The token name may already start with "Dr" (for example "Dr. Sara Ahmed").
const withTitle = (doctorName) => (/^dr\b/i.test(doctorName) ? doctorName : `Dr ${doctorName}`);

// '2026-10-21' -> 'Wednesday, 21 October 2026'
const longDate = (date) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

// paragraphs: plain lines; the HTML gets one <p> for each.
function email(subject, paragraphs) {
  return {
    subject,
    text: `${paragraphs.join('\n\n')}\n`,
    html: `<div style="font-family: Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #1f2937">${paragraphs
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('')}</div>`,
  };
}

export function prescriptionEmail({ patientName, doctorName }) {
  const doctor = withTitle(doctorName);
  return email(`Your prescription from ${doctor}`, [
    `Dear ${patientName},`,
    `Thank you for your visit. Your prescription from ${doctor} is attached to this email as a PDF.`,
    'If you have any questions about your medicines, please contact your doctor.',
    'Take care,\nMediAssist AI',
  ]);
}

// reminder: a claimed FOLLOW_UP_REMINDER row with the date and the names from FOLLOW_UP_CHANGE.
export function reminderEmail({ recipientType, followUpDate, doctorName, patientName }) {
  const doctor = withTitle(doctorName);
  const date = longDate(followUpDate);
  if (recipientType === 'doctor') {
    return email(`Follow-up reminder: ${patientName} on ${date}`, [
      `Dear ${doctor},`,
      `This is a reminder that ${patientName} has a follow-up visit with you on ${date}.`,
      'MediAssist AI',
    ]);
  }
  return email(`Reminder: your follow-up visit with ${doctor}`, [
    `Dear ${patientName},`,
    `This is a friendly reminder of your follow-up visit with ${doctor} on ${date}.`,
    'If you cannot come, please contact the clinic.',
    'Take care,\nMediAssist AI',
  ]);
}
