import { Check, CircleAlert, FileText, LayoutDashboard, Lock, Mail, MessageCircle, Mic, Sparkles, Users } from "lucide-react";
import { LogoMark } from "@/components/shared/logo";
import { cn } from "@/lib/utils";

// Static pictures of the product for the landing page and the auth panel. All patient data is sample data.

const BARS = [5, 9, 14, 8, 17, 11, 6, 13, 18, 10, 7, 15, 9, 12, 5, 16, 8, 11, 14, 6, 10, 17, 9, 7];

export function Waveform({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex h-6 items-center gap-[3px]", className)}>
      {BARS.map((h, i) => (
        <span
          key={i}
          className="w-[3px] origin-center animate-wave rounded-full bg-primary"
          style={{ height: `${h + 4}px`, animationDelay: `${(i % 6) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

function Chip({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "green" && "bg-secondary text-secondary-foreground",
        tone === "amber" && "bg-peach text-peach-foreground",
        tone === "red" && "bg-rec/10 text-rec",
      )}
    >
      {children}
    </span>
  );
}

function RecTimer() {
  return (
    <Chip tone="red">
      <span className="size-1.5 animate-blink rounded-full bg-rec" />
      <span className="tabular-nums">Recording 12:48</span>
    </Chip>
  );
}

// Browser window around a product screen (MediAssist is a web app).
function BrowserFrame({ url, className, children }: { url: string; className?: string; children: React.ReactNode }) {
  return (
    <div aria-hidden="true" className={cn("overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-lift", className)}>
      <div className="flex items-center gap-3 border-b bg-muted px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="mx-auto flex max-w-xs flex-1 items-center justify-center gap-1.5 rounded-md bg-background px-3 py-1 text-[11px] text-muted-foreground">
          <Lock className="size-3" />
          <span className="truncate">{url}</span>
        </div>
        <span className="hidden w-10.5 sm:block" />
      </div>
      {children}
    </div>
  );
}

const TRANSCRIPT = [
  { who: "Doctor", text: "Bukhar kab se hai?" },
  { who: "Patient", text: "Tinn din ton. Gala vi bahut kharab ae." },
  { who: "Doctor", text: "Khansi? … Temperature 101°F hai, throat red hai." },
  { who: "Doctor", text: "Panadol 500, din mein teen dafa, paanch din." },
];

const SOAP = [
  { letter: "S", title: "Subjective", text: "Fever and sore throat for 3 days. No cough." },
  { letter: "O", title: "Objective", text: "Temperature 101°F. Throat red, no swelling." },
  { letter: "A", title: "Assessment", text: "Acute pharyngitis." },
];

// Lines appear one by one when the page loads (CSS only, so this stays a server component).
const APPEAR = "animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-500";
const appearDelay = (index: number) => ({ animationDelay: `${0.4 + index * 0.15}s` });

function SoapNote() {
  return (
    <div className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-display text-sm font-bold">SOAP note</p>
        <Chip tone="green">
          <Check className="size-3" strokeWidth={3} />
          Ready in 12 s
        </Chip>
      </div>
      <div className="space-y-3.5">
        {SOAP.map(({ letter, title, text }, i) => (
          <div key={letter} style={appearDelay(i)} className={cn(APPEAR, "flex gap-3")}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold text-muted-foreground">
              {letter}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">{title}</p>
              <p className="text-sm leading-snug">{text}</p>
            </div>
          </div>
        ))}
        <div style={appearDelay(3)} className={cn(APPEAR, "flex gap-3")}>
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            P
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Plan</p>
            <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Paracetamol 500 mg</p>
                <p className="truncate text-xs text-muted-foreground">1 tablet · 3 times a day · 5 days</p>
              </div>
              <Chip tone="green">Matched</Chip>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-highlight bg-peach/50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Throat lozenges</p>
                <p className="flex items-center gap-1 text-xs text-peach-foreground">
                  <Sparkles className="size-3" />
                  AI suggested · you set the dose
                </p>
              </div>
              <span className="shrink-0 rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold text-background">Accept</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PatientBar() {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky text-xs font-bold text-sky-foreground">
          AR
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Ahmed Raza</p>
          <p className="truncate text-xs text-muted-foreground">45 years · Male · 0300 •••• 567</p>
        </div>
      </div>
      <RecTimer />
    </div>
  );
}

// The consultation screen: transcript and SOAP note. "panel" shows only the SOAP note card (auth panel).
export function ConsultationPreview({ className, variant = "full" }: { className?: string; variant?: "full" | "panel" }) {
  if (variant === "panel") {
    return (
      <div aria-hidden="true" className={cn("overflow-hidden rounded-2xl bg-card text-card-foreground shadow-lift", className)}>
        <PatientBar />
        <SoapNote />
      </div>
    );
  }
  const nav = [LayoutDashboard, Users, Mic, FileText];
  return (
    <BrowserFrame url="app.mediassist.ai/doctor/consultation" className={className}>
      <div className="flex">
        <div className="hidden w-14 shrink-0 flex-col items-center gap-3 border-r bg-sidebar py-4 sm:flex">
          <LogoMark className="size-7" />
          {nav.map((Icon, i) => (
            <span
              key={i}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg",
                i === 2 ? "bg-secondary text-secondary-foreground" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <PatientBar />
          <div className="grid md:grid-cols-[0.95fr_1.05fr] md:divide-x">
            <div className="border-b p-5 md:border-b-0">
              <div className="mb-4">
                <p className="font-display text-sm font-bold">Live transcript</p>
                <p className="text-[11px] font-medium text-muted-foreground">English · Urdu · Punjabi</p>
              </div>
              <ul className="space-y-3">
                {TRANSCRIPT.map(({ who, text }, i) => (
                  <li key={i} className={cn("space-y-0.5", i === 0 && "hidden sm:block")}>
                    <p className={cn("text-[11px] font-semibold", who === "Doctor" ? "text-primary" : "text-peach-foreground")}>
                      {who}
                    </p>
                    <p className="text-sm leading-snug">{text}</p>
                  </li>
                ))}
              </ul>
              <Waveform className="mt-5" />
            </div>
            <SoapNote />
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

// What the doctor said, and the medicine it was matched to (design doc FR-10).
export function MedicineMatchPreview() {
  const rows = [
    { said: "panadol five hundred", name: "Panadol 500 mg tablet", generic: "Paracetamol", status: "match" },
    { said: "augmentin 625", name: "Augmentin 625 mg tablet", generic: "Amoxicillin + clavulanic acid", status: "match" },
    { said: "woh throat spray", name: "No close match", generic: "Marked for you to review", status: "review" },
  ] as const;
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-2xl border bg-card shadow-soft">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <p className="font-display text-sm font-bold">Draft prescription</p>
        <span className="text-xs text-muted-foreground">Matched with the medicines list</span>
      </div>
      <ul className="divide-y">
        {rows.map((row) => (
          <li
            key={row.said}
            className="grid grid-cols-1 gap-1 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center sm:gap-4"
          >
            <span className="text-xs text-muted-foreground italic">“{row.said}”</span>
            <span className="min-w-0">
              <span className={cn("block truncate text-sm font-semibold", row.status === "review" && "text-muted-foreground")}>
                {row.name}
              </span>
              <span className="block truncate text-xs text-muted-foreground">{row.generic}</span>
            </span>
            {row.status === "match" ? (
              <Chip tone="green">
                <Check className="size-3" strokeWidth={3} />
                Matched
              </Chip>
            ) : (
              <Chip tone="amber">
                <CircleAlert className="size-3" />
                Review
              </Chip>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Sending and the follow-up reminder (design doc FR-10, FR-11).
export function DeliveryPreview({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-soft">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground">
          <MessageCircle className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Prescription sent</p>
          <p className="truncate text-xs text-muted-foreground">WhatsApp · 0300 •••• 567</p>
        </div>
        <Chip tone="green">
          <Check className="size-3" strokeWidth={3} />
          Sent
        </Chip>
      </div>
      <div className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-soft">
        <span className="flex size-10 shrink-0 flex-col items-center justify-center rounded-xl bg-sky leading-none text-sky-foreground">
          <span className="text-[9px] font-bold">OCT</span>
          <span className="text-sm font-extrabold tabular-nums">14</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Follow-up reminder</p>
          <p className="text-xs leading-snug text-muted-foreground">Emailed to you and the patient</p>
        </div>
        <Mail className="size-4 shrink-0 text-muted-foreground" />
      </div>
    </div>
  );
}

// One test value from a report, explained (design doc FR-2).
export function LabValuePreview({ className }: { className?: string }) {
  // Scale 8–18 g/dL. Normal range 12.0–15.5, value 10.2.
  const pos = (v: number) => `${((v - 8) / 10) * 100}%`;
  return (
    <div aria-hidden="true" className={cn("rounded-2xl border bg-card p-5 shadow-soft", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Haemoglobin</p>
        <p className="text-sm tabular-nums">
          <span className="font-display text-lg font-extrabold">10.2</span> <span className="text-muted-foreground">g/dL</span>
        </p>
      </div>
      <div className="relative mt-4 h-2 rounded-full bg-muted">
        <div
          className="absolute inset-y-0 rounded-full bg-primary/30"
          style={{ left: pos(12), right: `calc(100% - ${pos(15.5)})` }}
        />
        <div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-card bg-highlight shadow-xs"
          style={{ left: pos(10.2) }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>Low</span>
        <span>Normal 12.0–15.5</span>
        <span>High</span>
      </div>
      <p className="mt-4 border-t pt-4 text-sm leading-relaxed text-muted-foreground">
        A little <span className="font-semibold text-foreground">below normal</span>. This can make you feel tired. Ask
        your doctor if you need iron.
      </p>
    </div>
  );
}

// The symptom checker result (design doc FR-3).
export function SeverityPreview({ className }: { className?: string }) {
  const levels = ["Low", "Medium", "High"];
  return (
    <div aria-hidden="true" className={cn("rounded-2xl border bg-card p-5 shadow-soft", className)}>
      <p className="rounded-xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm">“Sar mein dard hai aur halka bukhar, do din se.”</p>
      <div className="mt-4 grid grid-cols-3 gap-1.5">
        {levels.map((level) => (
          <div key={level} className="space-y-1.5">
            <div
              className={cn("h-2 rounded-full", level === "Medium" ? "bg-highlight" : level === "Low" ? "bg-highlight/35" : "bg-muted")}
            />
            <p className={cn("text-[11px]", level === "Medium" ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {level}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm">
          See a <span className="font-semibold">General Physician</span>
        </p>
        <Chip tone="amber">Medium</Chip>
      </div>
    </div>
  );
}
