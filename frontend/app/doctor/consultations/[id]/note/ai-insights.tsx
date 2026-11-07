"use client";

import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ClipboardClock,
  ExternalLink,
  Pencil,
  Pill,
  Plus,
  Sparkles,
  Stethoscope,
  Trash,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  AiInsights,
  AiMedicine,
  AiMedicineInfo,
  AiSymptom,
  AiWarning,
  PrescriptionEdit,
  SoapNoteChanges,
  SymptomEdit,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

// What the AI Pipeline found, next to the note: warnings, symptoms, prescribed medicines with their
// dataset info, suggestions for the doctor to review, and medication history. All of it is a draft
// for the doctor: the prescription and symptoms can be edited, and accepting a suggestion adds it to
// the prescription (with its dataset info), where it is edited and saved like the others.

// Medicine info is shortened to this many words in total, so one medicine never fills the screen.
const INFO_MAX_WORDS = 200;

const INFO_FIELDS: [keyof AiMedicineInfo, string][] = [
  ["indication", "Used for"],
  ["dosageReference", "Usual dose"],
  ["howToUse", "How to use"],
  ["sideEffects", "Side effects"],
  ["contraindications", "Do not use when"],
  ["warnings", "Warnings"],
  ["precautions", "Precautions"],
  ["drugInteractions", "Drug interactions"],
  ["mechanism", "How it works"],
];

const SOURCE_LABEL: Record<string, string> = { dawaai: "Dawaai", dvago: "DVAGO" };

const HISTORY_STATUS: Record<string, string> = {
  currently_taking: "Taking now",
  stopped: "Stopped",
  completed: "Finished",
};

const sectionClass = "rounded-[1.5rem] border bg-card p-5 sm:p-6";

// Saves the edited prescription or symptoms; true when it worked.
type SaveEdits = (changes: SoapNoteChanges) => Promise<boolean>;

// "dawaai.pk" for a dataset link; null for anything that is not an http(s) URL.
function hostOf(url: string) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

const sameText = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// The info fields that fit in INFO_MAX_WORDS, in order; the last one is cut with "…" when needed.
function shortenInfo(info: AiMedicineInfo) {
  let left = INFO_MAX_WORDS;
  let shortened = false;
  const fields: { key: keyof AiMedicineInfo; label: string; text: string }[] = [];
  for (const [key, label] of INFO_FIELDS) {
    const value = info[key];
    if (typeof value !== "string" || !value.trim()) continue;
    if (left <= 0) {
      shortened = true;
      break;
    }
    // Split on spaces only, so the "Dawaai:" / "DVAGO:" paragraphs keep their line breaks.
    const words = value.trim().split(/[ \t]+/);
    if (words.length > left) {
      fields.push({ key, label, text: `${words.slice(0, left).join(" ").replace(/[\s,;.:]+$/, "")}…` });
      shortened = true;
      left = 0;
    } else {
      fields.push({ key, label, text: value.trim() });
      left -= words.length;
    }
  }
  return { fields, shortened };
}

export function AiWarnings({ warnings }: { warnings: AiWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div role="alert" className="flex gap-3 rounded-[1.5rem] border border-highlight/40 bg-peach p-4 text-peach-foreground sm:p-5">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="font-semibold">Some parts need your review</p>
        <ul className="space-y-1 text-sm">
          {warnings.map((w, i) => (
            <li key={i}>
              {w.section && <span className="font-medium">{w.section}: </span>}
              {w.message ?? "This part could not be generated automatically."}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AiInsightsPanel({ insights: initial, onSaveEdits }: { insights: AiInsights; onSaveEdits: SaveEdits }) {
  // The lists shown; replaced by the doctor's version after each saved edit.
  const [prescription, setPrescription] = useState(initial.prescription);
  const [symptoms, setSymptoms] = useState(initial.symptoms);
  // The prescription being edited, or null. Kept here, so accepting a suggestion can open it.
  const [drafts, setDrafts] = useState<MedicineDraft[] | null>(null);
  const prescriptionRef = useRef<HTMLElement>(null);

  // Opens the prescription editor with the suggestion added, for the doctor to fill in and save.
  const accept = (medicine: AiMedicine) => {
    const current = drafts ?? prescription.map(toDraft);
    const added = current.some((d) => d.reviewIndex === medicine.reviewIndex);
    setDrafts(added ? current : [...current, { ...toDraft(medicine), aiIndex: null }]);
    requestAnimationFrame(() => prescriptionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const savedReviews = new Set(prescription.map((m) => m.reviewIndex).filter((i) => i !== null));
  const pendingReviews = new Set((drafts ?? []).map((d) => d.reviewIndex).filter((i) => i !== null));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1 pt-2">
        <Sparkles aria-hidden="true" className="size-5 text-primary" />
        <h2 className="font-display text-lg font-bold tracking-tight">Found by MediAssist AI</h2>
      </div>
      {initial.forDoctorReview.length > 0 && (
        <ReviewSection medicines={initial.forDoctorReview} saved={savedReviews} pending={pendingReviews} onAccept={accept} />
      )}
      <PrescriptionSection
        sectionRef={prescriptionRef}
        medicines={prescription}
        drafts={drafts}
        setDrafts={setDrafts}
        aiMedicines={initial.prescription}
        reviewMedicines={initial.forDoctorReview}
        onSave={async (edits) => {
          if (!(await onSaveEdits({ prescription: edits }))) return false;
          setPrescription(edits.map((edit) => mergeMedicine(edit, initial.prescription, initial.forDoctorReview)));
          return true;
        }}
      />
      <SymptomsSection
        symptoms={symptoms}
        onSave={async (edits) => {
          if (!(await onSaveEdits({ symptoms: edits }))) return false;
          setSymptoms(edits.map((edit) => mergeSymptom(edit, initial.symptoms)));
          return true;
        }}
      />
      {initial.medicationHistory.length > 0 && <HistorySection items={initial.medicationHistory} />}
    </div>
  );
}

// Same rule as the Consultation Service: the dataset info of the prescribed medicine or accepted
// suggestion it came from stays only while the medicine name is the same.
function mergeMedicine(edit: PrescriptionEdit, aiMedicines: AiMedicine[], reviewMedicines: AiMedicine[]): AiMedicine {
  const prescribed = edit.aiIndex !== null ? aiMedicines.find((m) => m.aiIndex === edit.aiIndex) : undefined;
  const suggested = !prescribed && edit.reviewIndex !== null ? reviewMedicines.find((m) => m.reviewIndex === edit.reviewIndex) : undefined;
  const base = prescribed ?? suggested;
  const same = base && sameText(base.name, edit.name);
  return {
    aiIndex: prescribed ? edit.aiIndex : null,
    reviewIndex: suggested ? edit.reviewIndex : null,
    name: edit.name,
    genericName: edit.genericName,
    strength: same ? base.strength : null,
    dose: edit.dose,
    frequency: edit.frequency,
    duration: edit.duration,
    route: same ? base.route : null,
    instructions: edit.instructions,
    matchStatus: same ? base.matchStatus : "doctor_added",
    linkedSymptoms: same ? base.linkedSymptoms : [],
    suggestionReason: null,
    info: same ? base.info : null,
  };
}

function mergeSymptom(edit: SymptomEdit, aiSymptoms: AiSymptom[]): AiSymptom {
  const base = edit.aiIndex !== null ? aiSymptoms.find((s) => s.aiIndex === edit.aiIndex) : undefined;
  const same = base && sameText(base.symptom, edit.symptom);
  return {
    aiIndex: base ? edit.aiIndex : null,
    symptom: edit.symptom,
    mention: same ? base.mention : null,
    sourceText: same ? base.sourceText : null,
    matchedLabels: same ? base.matchedLabels : [],
  };
}

function SectionHeader({
  id,
  icon: Icon,
  title,
  hint,
  tone,
  action,
}: {
  id: string;
  icon: typeof Pill;
  title: string;
  hint: string;
  tone: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tone)}>
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 id={id} className="font-display text-xl font-bold tracking-tight">
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} aria-label={label}>
      <Pencil aria-hidden="true" data-icon="inline-start" />
      Edit
    </Button>
  );
}

function EditFooter({ saving, canSave, onCancel, onSave }: { saving: boolean; canSave: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
      <Button variant="outline" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button onClick={onSave} disabled={saving || !canSave}>
        {saving ? <Spinner className="size-4 text-current" label="Saving" /> : <Check aria-hidden="true" data-icon="inline-start" />}
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- suggestions for the doctor
function ReviewSection({
  medicines,
  saved,
  pending,
  onAccept,
}: {
  medicines: AiMedicine[];
  // reviewIndex values in the saved prescription, and in the prescription being edited.
  saved: Set<number | null>;
  pending: Set<number | null>;
  onAccept: (medicine: AiMedicine) => void;
}) {
  // Rejected suggestions are hidden for this visit of the page only; nothing is saved for them.
  const [rejected, setRejected] = useState<Set<number>>(() => new Set());
  const toggleRejected = (index: number) =>
    setRejected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <section aria-labelledby="ai-review-title" className={cn(sectionClass, "border-highlight/40 bg-peach/60")}>
      <SectionHeader
        id="ai-review-title"
        icon={TriangleAlert}
        title="Suggestions for your review"
        hint="Medicines from the datasets that match the symptoms. The doctor did not prescribe these. Accept adds one to the prescription, where you can set the dose."
        tone="bg-peach text-peach-foreground ring-1 ring-highlight/40"
      />
      <ul className="mt-5 space-y-3">
        {medicines.map((medicine, index) => {
          const inPrescription = saved.has(medicine.reviewIndex);
          const waiting = !inPrescription && pending.has(medicine.reviewIndex);
          if (rejected.has(index) && !inPrescription && !waiting) {
            return (
              <li key={index} className="flex items-center justify-between gap-3 rounded-2xl border border-dashed bg-card/60 px-4 py-3">
                <p className="min-w-0 truncate text-sm text-muted-foreground">
                  <span className="line-through">{medicine.name}</span> · rejected
                </p>
                <Button variant="ghost" size="sm" onClick={() => toggleRejected(index)}>
                  <Undo2 aria-hidden="true" data-icon="inline-start" />
                  Undo
                </Button>
              </li>
            );
          }
          return (
            <li key={index} className="rounded-2xl border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <MedicineTitle medicine={medicine} />
                  {medicine.suggestionReason && <p className="text-sm leading-relaxed">{medicine.suggestionReason}</p>}
                  <LinkedSymptoms symptoms={medicine.linkedSymptoms} />
                </div>
                <div className="flex shrink-0 gap-2">
                  {inPrescription ? (
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-mint px-3 text-sm font-semibold text-mint-foreground">
                      <Check aria-hidden="true" className="size-4" />
                      In the prescription
                    </span>
                  ) : waiting ? (
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-peach px-3 text-sm font-semibold text-peach-foreground ring-1 ring-highlight/40">
                      <Pencil aria-hidden="true" className="size-4" />
                      Added – save the prescription
                    </span>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => onAccept(medicine)}>
                        <Check aria-hidden="true" data-icon="inline-start" />
                        Accept
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggleRejected(index)}>
                        <X aria-hidden="true" data-icon="inline-start" />
                        Reject
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <MedicineInfo info={medicine.info} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- prescribed medicines
type MedicineDraft = {
  key: number;
  aiIndex: number | null;
  reviewIndex: number | null;
  name: string;
  genericName: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
};

let nextDraftKey = 1;
const toDraft = (m: AiMedicine): MedicineDraft => ({
  key: nextDraftKey++,
  aiIndex: m.aiIndex,
  reviewIndex: m.reviewIndex,
  name: m.name ?? "",
  genericName: m.genericName ?? "",
  dose: m.dose ?? m.strength ?? "",
  frequency: m.frequency ?? "",
  duration: m.duration ?? "",
  instructions: m.instructions ?? "",
});
const emptyDraft = (): MedicineDraft => ({
  key: nextDraftKey++,
  aiIndex: null,
  reviewIndex: null,
  name: "",
  genericName: "",
  dose: "",
  frequency: "",
  duration: "",
  instructions: "",
});
const orNull = (value: string) => value.trim() || null;

function PrescriptionSection({
  sectionRef,
  medicines,
  drafts,
  setDrafts,
  aiMedicines,
  reviewMedicines,
  onSave,
}: {
  sectionRef: React.Ref<HTMLElement>;
  medicines: AiMedicine[];
  drafts: MedicineDraft[] | null;
  setDrafts: React.Dispatch<React.SetStateAction<MedicineDraft[] | null>>;
  aiMedicines: AiMedicine[];
  reviewMedicines: AiMedicine[];
  onSave: (edits: PrescriptionEdit[]) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const editing = drafts !== null;
  // A blank row is ignored; a row with any field filled needs a name.
  const filled = (d: MedicineDraft) => [d.name, d.genericName, d.dose, d.frequency, d.duration, d.instructions].some((v) => v.trim());
  const missingName = drafts?.some((d) => filled(d) && !d.name.trim()) ?? false;

  const update = (key: number, field: keyof Omit<MedicineDraft, "key" | "aiIndex">, value: string) =>
    setDrafts((current) => current && current.map((d) => (d.key === key ? { ...d, [field]: value } : d)));

  const save = async () => {
    if (!drafts || missingName) return;
    setSaving(true);
    const edits: PrescriptionEdit[] = drafts.filter(filled).map((d) => ({
      // A row keeps its AI medicine (or accepted suggestion) only while that one still exists.
      aiIndex: d.aiIndex !== null && aiMedicines.some((m) => m.aiIndex === d.aiIndex) ? d.aiIndex : null,
      reviewIndex: d.reviewIndex !== null && reviewMedicines.some((m) => m.reviewIndex === d.reviewIndex) ? d.reviewIndex : null,
      name: d.name.trim(),
      genericName: orNull(d.genericName),
      dose: orNull(d.dose),
      frequency: orNull(d.frequency),
      duration: orNull(d.duration),
      instructions: orNull(d.instructions),
    }));
    if (await onSave(edits)) setDrafts(null);
    setSaving(false);
  };

  return (
    <section ref={sectionRef} aria-labelledby="ai-prescription-title" className={cn(sectionClass, "scroll-mt-40")}>
      <SectionHeader
        id="ai-prescription-title"
        icon={Pill}
        title="Prescription"
        hint={
          editing
            ? "Change, add or remove medicines. The medicine info stays while the name stays the same."
            : "The medicines prescribed in the consultation, with their information from Dawaai and DVAGO."
        }
        tone="bg-mint text-mint-foreground"
        action={!editing && <EditButton label="Edit prescription" onClick={() => setDrafts(medicines.length ? medicines.map(toDraft) : [emptyDraft()])} />}
      />

      {editing ? (
        <>
          <ul className="mt-5 space-y-3">
            {drafts.map((d, index) => (
              <li
                key={d.key}
                className={cn("rounded-2xl border p-4", d.reviewIndex !== null ? "border-highlight/40 bg-peach/40" : "bg-muted/40")}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
                    Medicine {index + 1}
                    {d.reviewIndex !== null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-peach px-2 py-0.5 text-xs font-semibold text-peach-foreground">
                        <Sparkles aria-hidden="true" className="size-3" />
                        AI suggestion
                      </span>
                    )}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDrafts((current) => current && current.filter((x) => x.key !== d.key))}
                  >
                    <Trash aria-hidden="true" data-icon="inline-start" />
                    Remove
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="Medicine name"
                    value={d.name}
                    onChange={(v) => update(d.key, "name", v)}
                    placeholder="Panadol 500 mg"
                    maxLength={200}
                    invalid={filled(d) && !d.name.trim()}
                    error="Enter the medicine name"
                  />
                  <Field label="Generic name" value={d.genericName} onChange={(v) => update(d.key, "genericName", v)} placeholder="Paracetamol" maxLength={200} />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Dose" value={d.dose} onChange={(v) => update(d.key, "dose", v)} placeholder="1 tablet" maxLength={100} />
                  <Field label="How often" value={d.frequency} onChange={(v) => update(d.key, "frequency", v)} placeholder="Twice a day" maxLength={100} />
                  <Field label="How long" value={d.duration} onChange={(v) => update(d.key, "duration", v)} placeholder="5 days" maxLength={100} />
                </div>
                <div className="mt-3">
                  <Field
                    label="Instructions"
                    value={d.instructions}
                    onChange={(v) => update(d.key, "instructions", v)}
                    placeholder="After meals"
                    maxLength={500}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="mt-3 w-full border-dashed" onClick={() => setDrafts((current) => [...(current ?? []), emptyDraft()])}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add medicine
          </Button>
          <EditFooter saving={saving} canSave={!missingName} onCancel={() => setDrafts(null)} onSave={save} />
        </>
      ) : medicines.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No medicines were prescribed. Use Edit to add one.
        </p>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border">
          <div className="hidden grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] gap-4 bg-muted px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:grid">
            <span>Medicine</span>
            <span>Dose</span>
            <span>How often</span>
            <span>How long</span>
          </div>
          <ul className="divide-y">
            {medicines.map((medicine, index) => (
              <li key={index} className="px-4 py-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] sm:items-start">
                  <div className="col-span-2 min-w-0 space-y-1 sm:col-span-1">
                    <MedicineTitle medicine={medicine} />
                    {medicine.reviewIndex !== null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-peach px-2 py-0.5 text-xs font-semibold text-peach-foreground">
                        <Sparkles aria-hidden="true" className="size-3" />
                        Accepted AI suggestion
                      </span>
                    )}
                    <LinkedSymptoms symptoms={medicine.linkedSymptoms} />
                  </div>
                  <Cell label="Dose" value={medicine.dose ?? medicine.strength} />
                  <Cell label="How often" value={medicine.frequency} />
                  <Cell label="How long" value={medicine.duration} />
                  {medicine.instructions && (
                    <p dir="auto" className="col-span-2 text-sm text-muted-foreground sm:col-span-4">
                      {medicine.instructions}
                    </p>
                  )}
                </div>
                <MedicineInfo info={medicine.info} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  invalid = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
  invalid?: boolean;
  error?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <Input
        dir="auto"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={invalid || undefined}
        className="mt-1 h-10 bg-card"
      />
      {invalid && error && <span className="mt-1 block text-xs font-medium text-destructive">{error}</span>}
    </label>
  );
}

function Cell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground sm:hidden">{label}</p>
      <p dir="auto" className={cn("text-sm break-words", value ? "font-medium" : "text-muted-foreground")}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function MedicineTitle({ medicine }: { medicine: AiMedicine }) {
  const status = medicine.matchStatus;
  return (
    <div className="min-w-0">
      <p dir="auto" className="font-semibold break-words">
        {medicine.name ?? medicine.genericName ?? "Unnamed medicine"}
      </p>
      {medicine.genericName && medicine.genericName !== medicine.name && (
        <p dir="auto" className="text-sm break-words text-muted-foreground">
          {medicine.genericName}
        </p>
      )}
      {status === "doctor_added" && <p className="mt-1 text-xs font-medium text-muted-foreground">Added by the doctor</p>}
    </div>
  );
}

function LinkedSymptoms({ symptoms }: { symptoms: string[] }) {
  if (symptoms.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      For: <span className="font-medium text-foreground">{symptoms.join(", ")}</span>
    </p>
  );
}

function MedicineInfo({ info }: { info: AiMedicineInfo | null }) {
  if (!info) return null;
  const { fields, shortened } = shortenInfo(info);
  const links = info.urls.flatMap((url) => {
    const host = hostOf(url);
    return host ? [{ url, host }] : [];
  });
  if (fields.length === 0 && links.length === 0) return null;

  return (
    <details className="group mt-3 rounded-xl bg-muted/70 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-primary outline-none select-none focus-visible:ring-2 focus-visible:ring-ring">
        Medicine info
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          {info.sources.map((s) => SOURCE_LABEL[s] ?? s).join(" · ")}
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="space-y-4 px-3 pt-1 pb-4">
        {info.matchedProducts.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Matched products: <span className="font-medium text-foreground">{info.matchedProducts.join(", ")}</span>
          </p>
        )}
        <dl className="space-y-3">
          {fields.map(({ key, label, text }) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
              <dd className="mt-1 text-sm leading-relaxed break-words whitespace-pre-line">{text}</dd>
            </div>
          ))}
        </dl>
        {(shortened || links.length > 0) && (
          <div className="space-y-2 border-t pt-3">
            {shortened && (
              <p className="text-xs text-muted-foreground">
                Shortened to {INFO_MAX_WORDS} words.{links.length > 0 && " See the full details at the source:"}
              </p>
            )}
            {links.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {links.map(({ url, host }) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium hover:bg-accent"
                  >
                    {host}
                    <ExternalLink aria-hidden="true" className="size-3" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- symptoms
type SymptomDraft = { key: number; aiIndex: number | null; symptom: string };

function SymptomsSection({ symptoms, onSave }: { symptoms: AiSymptom[]; onSave: (edits: SymptomEdit[]) => Promise<boolean> }) {
  const [drafts, setDrafts] = useState<SymptomDraft[] | null>(null);
  const [newSymptom, setNewSymptom] = useState("");
  const [saving, setSaving] = useState(false);
  const editing = drafts !== null;

  const startEditing = () => {
    setDrafts(symptoms.filter((s) => s.symptom).map((s) => ({ key: nextDraftKey++, aiIndex: s.aiIndex, symptom: s.symptom! })));
    setNewSymptom("");
  };

  const add = () => {
    const text = newSymptom.trim();
    if (!text) return;
    setDrafts((current) => {
      if (!current || current.some((d) => sameText(d.symptom, text))) return current;
      return [...current, { key: nextDraftKey++, aiIndex: null, symptom: text }];
    });
    setNewSymptom("");
  };

  const save = async () => {
    if (!drafts) return;
    setSaving(true);
    // A symptom typed but not added yet is saved too.
    const pending = newSymptom.trim();
    const all = pending && !drafts.some((d) => sameText(d.symptom, pending)) ? [...drafts, { key: 0, aiIndex: null, symptom: pending }] : drafts;
    const edits = all.filter((d) => d.symptom.trim()).map((d) => ({ aiIndex: d.aiIndex, symptom: d.symptom.trim() }));
    if (await onSave(edits)) {
      setDrafts(null);
      setNewSymptom("");
    }
    setSaving(false);
  };

  return (
    <section aria-labelledby="ai-symptoms-title" className={sectionClass}>
      <SectionHeader
        id="ai-symptoms-title"
        icon={Stethoscope}
        title="Symptoms"
        hint={editing ? "Remove a symptom with ×, or type a new one and press Enter." : "Point at or tap a symptom to see what the patient said."}
        tone="bg-sky text-sky-foreground"
        action={!editing && <EditButton label="Edit symptoms" onClick={startEditing} />}
      />

      {editing ? (
        <>
          <ul className="mt-5 flex flex-wrap gap-2">
            {drafts.map((d) => (
              <li
                key={d.key}
                className="inline-flex items-center gap-1 rounded-full bg-sky py-1 pr-1 pl-3 text-sm font-medium text-sky-foreground capitalize"
              >
                <span dir="auto">{d.symptom}</span>
                <button
                  type="button"
                  aria-label={`Remove ${d.symptom}`}
                  onClick={() => setDrafts((current) => current && current.filter((x) => x.key !== d.key))}
                  className="flex size-6 items-center justify-center rounded-full outline-none hover:bg-sky-foreground/15 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            ))}
            {drafts.length === 0 && <li className="text-sm text-muted-foreground">No symptoms. Add one below.</li>}
          </ul>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <Input
              dir="auto"
              value={newSymptom}
              onChange={(event) => setNewSymptom(event.target.value)}
              placeholder="Add a symptom, like headache"
              maxLength={100}
              aria-label="New symptom"
              className="h-10"
            />
            <Button type="submit" variant="outline" disabled={!newSymptom.trim()}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add
            </Button>
          </form>
          <EditFooter saving={saving} canSave onCancel={() => setDrafts(null)} onSave={save} />
        </>
      ) : symptoms.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No symptoms were found. Use Edit to add them.
        </p>
      ) : (
        <ul className="mt-5 flex flex-wrap gap-2">
          {symptoms.map((symptom, index) => (
            <li key={index}>
              <SymptomChip symptom={symptom} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SymptomChip({ symptom }: { symptom: AiSymptom }) {
  const [open, setOpen] = useState(false);
  const matched = symptom.matchedLabels.length > 0;
  const fromTranscript = symptom.sourceText !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(false)}
        className="inline-flex items-center gap-1.5 rounded-full bg-sky px-3 py-1.5 text-sm font-medium text-sky-foreground capitalize transition-colors outline-none hover:ring-2 hover:ring-sky-foreground/20 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span dir="auto">{symptom.symptom ?? symptom.mention}</span>
        {!matched && <span className="size-1.5 rounded-full bg-highlight" aria-label="no dataset match" />}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-3 p-4" onOpenAutoFocus={(e) => e.preventDefault()}>
        <figure className="space-y-1">
          <figcaption className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">From the transcript</figcaption>
          {fromTranscript ? (
            <blockquote dir="auto" className="border-l-2 border-primary pl-3 text-sm leading-relaxed italic">
              {symptom.sourceText}
            </blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">Added or changed by the doctor.</p>
          )}
        </figure>
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Dataset match</p>
          {matched ? (
            <div className="flex flex-wrap gap-1.5">
              {symptom.matchedLabels.map((label) => (
                <span key={label} className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {label}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No matching label in the datasets.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- medication history
function HistorySection({ items }: { items: AiInsights["medicationHistory"] }) {
  return (
    <section aria-labelledby="ai-history-title" className={sectionClass}>
      <SectionHeader
        id="ai-history-title"
        icon={ClipboardClock}
        title="Medication history"
        hint="Medicines the patient said they take or took before."
        tone="bg-muted text-foreground"
      />
      <ul className="mt-5 divide-y rounded-2xl border">
        {items.map((item, index) => (
          <li key={index} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p dir="auto" className="font-semibold break-words">
                {item.medicineName ?? "Unnamed medicine"}
              </p>
              <p className="text-sm text-muted-foreground">
                {[item.condition, item.frequency, item.duration].filter(Boolean).join(" · ") || "No details"}
              </p>
            </div>
            {item.status && (
              <span className="self-start rounded-full bg-muted px-2.5 py-1 text-xs font-semibold sm:self-auto">
                {HISTORY_STATUS[item.status] ?? item.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
