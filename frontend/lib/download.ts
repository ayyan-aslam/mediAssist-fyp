// Saves a downloaded file (like a PDF) with the given name.
export function saveFile(file: Blob, fileName: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download after click() returns, so the link is freed a little later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Like "SOAP note - Bilal Hussain - 2026-10-07.pdf", with the local date of the given time.
// Characters that file names cannot hold are removed.
export function pdfFileName(title: string, patientName: string, iso: string) {
  const name = patientName.replace(/[\/:*?"<>|]+/g, "").trim();
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${title} - ${name} - ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.pdf`;
}
