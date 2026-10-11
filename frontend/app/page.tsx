import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Ban, Check, FolderLock, KeyRound, Lock, ScrollText, ShieldCheck } from "lucide-react";
import { LandingHeader } from "@/components/shared/landing-header";
import { Logo } from "@/components/shared/logo";
import {
  ConsultationPreview,
  DeliveryPreview,
  LabValuePreview,
  MedicineMatchPreview,
  SeverityPreview,
} from "@/components/shared/product-previews";
import { Reveal } from "@/components/shared/reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import clinicTeam from "@/public/images/clinic-team.jpg";
import consultation from "@/public/images/consultation.jpg";
import patient from "@/public/images/patient.jpg";

// Every number and claim on this page comes from the design doc (Sections 1.2, 2.1 and 2.2).
// Photos are CC0 stock (public/images/CREDITS.md) and only illustrate.

const TILES = [
  {
    href: "#features",
    tone: "navy",
    big: "Record",
    small: "and relax",
    items: ["Live transcript", "English, Urdu, Punjabi", "Up to 30 minutes"],
  },
  {
    href: "#features",
    tone: "mint",
    big: "Notes",
    small: "in seconds",
    items: ["SOAP note in about 15 s", "Edit, saved every 30 s", "Download as PDF"],
  },
  {
    href: "#prescriptions",
    tone: "sky",
    big: "Prescribe",
    small: "smarter",
    items: ["Matched to the medicines list", "AI ideas you approve", "Sent on WhatsApp or email"],
  },
  {
    href: "#patients",
    tone: "peach",
    big: "Patients",
    small: "understood",
    items: ["Reports in simple words", "Symptom checker", "Saved chat history"],
  },
] as const;

const TILE_TONE = {
  navy: "bg-navy text-navy-foreground dark:ring-1 dark:ring-navy-border",
  mint: "bg-mint text-mint-foreground",
  sky: "bg-sky text-sky-foreground",
  peach: "bg-peach text-peach-foreground",
} as const;

const STATS = [
  { value: "15 s", label: "From stopping the recording to a ready SOAP note" },
  { value: "30 s", label: "To deliver the prescription by email or WhatsApp" },
  { value: "2 clicks", label: "From patient details to recording" },
  { value: "AES-256", label: "Encryption for CNIC, audio and documents" },
];

const STEPS = [
  { title: "Add the patient", text: "Name, age, gender and phone. A returning patient loads from the phone number." },
  { title: "Record the visit", text: "Talk as you always do, in English, Urdu, Punjabi or a mix. Up to 30 minutes." },
  { title: "Review the note", text: "Edit the SOAP note and the draft prescription. Edits save every 30 seconds." },
  { title: "Send and follow up", text: "Send the PDF on WhatsApp or email, and set the follow-up date." },
];

const SECURITY = [
  { icon: Lock, title: "Encrypted at rest", text: "AES-256 for CNIC numbers, consultation audio and uploaded documents." },
  { icon: ShieldCheck, title: "Encrypted in transit", text: "HTTPS with TLS 1.2 or higher, for every request." },
  { icon: KeyRound, title: "Short sessions", text: "15-minute access tokens. Refresh tokens last 7 days, are stored as hashes and change on every use." },
  { icon: Ban, title: "Instant suspension", text: "A suspended account is blocked at the gateway at once, on every device." },
  { icon: FolderLock, title: "Private files", text: "Private storage with versioning, opened only through short-lived links." },
  { icon: ScrollText, title: "Audit log", text: "Logins, SOAP note edits, sends and suspensions. Kept for a year. No one can edit it." },
];

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-sm font-semibold text-primary", className)}>{children}</p>;
}

function H2({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h2 className={cn("font-display text-[2.25rem] leading-[1.05] font-extrabold tracking-[-0.03em] sm:text-5xl", className)}>
      {children}
    </h2>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
            <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          </span>
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

// Alternating text and picture rows, like a product tour.
function FeatureRow({
  id,
  eyebrow,
  title,
  text,
  points,
  visual,
  reverse = false,
  wideVisual = false,
}: {
  id?: string;
  eyebrow: string;
  title: React.ReactNode;
  text: string;
  points: string[];
  visual: React.ReactNode;
  reverse?: boolean;
  wideVisual?: boolean;
}) {
  return (
    <div
      id={id}
      className={cn(
        "grid scroll-mt-24 grid-cols-1 items-center gap-10 lg:gap-16",
        wideVisual ? "lg:grid-cols-[1fr_1.3fr]" : "lg:grid-cols-2",
      )}
    >
      <Reveal className={cn("max-w-xl space-y-6", reverse && "lg:order-2")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <H2>{title}</H2>
        <p className="text-lg leading-relaxed text-muted-foreground">{text}</p>
        <Points items={points} />
      </Reveal>
      <Reveal delay={0.08} className={cn("min-w-0", reverse && "lg:order-1")}>
        {visual}
      </Reveal>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background">
      <LandingHeader />

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-14 px-4 pt-8 pb-20 sm:px-6 sm:pt-12 lg:grid-cols-[1fr_1fr] lg:gap-12 lg:px-8 lg:pt-16 lg:pb-28">
          <Reveal className="space-y-8">
            <Eyebrow>For doctors and patients in Pakistan · English, Urdu and Punjabi</Eyebrow>
            <h1 className="font-display text-[2.9rem] leading-[1] font-extrabold tracking-[-0.04em] sm:text-6xl lg:text-[4.1rem] xl:text-[4.5rem]">
              Record the visit
              <span className="block text-primary">We write the notes</span>
            </h1>
            <p className="max-w-lg text-lg leading-relaxed text-muted-foreground sm:text-xl">
              MediAssist AI turns your consultation into a SOAP note and a draft prescription from the medicines list.
              You check it and send it to the patient on WhatsApp or email.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup/doctor">
                  Create doctor account
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Log in</Link>
              </Button>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2.5 text-sm font-medium text-foreground/80">
              {["Doctors review every line", "AI suggestions clearly marked", "Works on any screen"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check aria-hidden="true" className="size-4 text-primary" strokeWidth={3} />
                  {item}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal delay={0.1} className="relative lg:pb-10">
            <div className="rounded-[2rem] bg-mint p-3 sm:p-4">
              <Image
                src={consultation}
                alt="A doctor listening to a patient at a clinic desk"
                priority
                placeholder="blur"
                sizes="(min-width: 1024px) 600px, 100vw"
                className="aspect-[4/3] w-full rounded-[1.5rem] object-cover"
              />
            </div>
            <div className="relative -mt-20 px-4 sm:px-10 lg:absolute lg:bottom-0 lg:-left-6 lg:mt-0 lg:w-[22rem] lg:px-0 xl:-left-10">
              <ConsultationPreview variant="panel" />
            </div>
          </Reveal>
        </section>

        {/* Service tiles */}
        <section aria-label="What MediAssist AI does" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TILES.map((tile, index) => (
              <Reveal key={tile.big} delay={index * 0.05} className="flex">
                <a
                  href={tile.href}
                  className={cn(
                    "group flex min-h-[21rem] w-full flex-col rounded-[1.75rem] p-7 transition-transform duration-300 hover:-translate-y-1",
                    TILE_TONE[tile.tone],
                  )}
                >
                  <p className="font-display leading-[0.95] font-extrabold tracking-[-0.035em]">
                    <span className="block text-5xl">{tile.big}</span>
                    <span className="block text-3xl">{tile.small}</span>
                  </p>
                  <ul className="mt-7 space-y-2.5">
                    {tile.items.map((item) => (
                      <li key={item} className="flex items-center gap-2.5 font-semibold">
                        <Check aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <span className="mt-auto flex size-11 items-center justify-center self-end rounded-full bg-current/10 transition-colors group-hover:bg-current/20">
                    <ArrowUpRight aria-hidden="true" className="size-5" />
                  </span>
                </a>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section aria-label="In numbers" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <dl className="grid grid-cols-2 gap-y-10 lg:grid-cols-4">
            {STATS.map(({ value, label }, index) => (
              <Reveal
                key={value}
                delay={index * 0.05}
                className={cn("space-y-2 pr-4", index % 2 === 1 && "border-l pl-6", index === 2 && "lg:border-l lg:pl-6")}
              >
                <dt className="font-display text-4xl font-extrabold tracking-[-0.04em] tabular-nums sm:text-6xl">{value}</dt>
                <dd className="max-w-[15rem] leading-snug text-muted-foreground">{label}</dd>
              </Reveal>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-24 bg-muted">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
            <Reveal className="max-w-2xl space-y-4">
              <Eyebrow>How it works</Eyebrow>
              <H2>From the first word to the sent prescription</H2>
              <p className="text-lg leading-relaxed text-muted-foreground">
                Four steps in the browser. A doctor can learn the whole module in under 30 minutes.
              </p>
            </Reveal>
            <ol className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(({ title, text }, index) => (
                <li key={title} className="flex">
                  <Reveal delay={index * 0.06} className="flex w-full flex-col rounded-[1.75rem] bg-card p-7 shadow-soft">
                    <span className="font-display text-5xl font-extrabold tracking-tight text-primary">{index + 1}</span>
                    <h3 className="mt-8 text-xl font-bold tracking-tight">{title}</h3>
                    <p className="mt-2 leading-relaxed text-muted-foreground">{text}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Feature rows */}
        <section id="features" className="mx-auto max-w-7xl scroll-mt-24 space-y-24 px-4 py-24 sm:px-6 lg:space-y-32 lg:px-8 lg:py-32">
          <FeatureRow
            eyebrow="SOAP notes"
            title={<>Talk to your patient<br />The note writes itself</>}
            text="The recording is turned into text minute by minute while you talk, so the SOAP note is ready about 15 seconds after you stop."
            points={["Subjective, Objective, Assessment and Plan", "Medicines you mention go into the Plan", "Edit freely, download as a PDF"]}
            wideVisual
            visual={
              <div className="rounded-[2rem] bg-sky p-4 sm:p-8">
                <ConsultationPreview />
              </div>
            }
          />

          <FeatureRow
            id="prescriptions"
            eyebrow="Prescriptions"
            title={<>Matched to the medicines list<br />Approved by you</>}
            text="Each medicine you say is matched with the medicines list, even when the wording is different. No close match? It is marked for your review."
            points={["AI suggestions are labelled and need your OK", "You set the dose for every suggestion", "See whether the prescription was delivered"]}
            reverse
            visual={
              <div className="space-y-4 rounded-[2rem] bg-mint p-4 sm:p-8">
                <MedicineMatchPreview />
                <DeliveryPreview className="sm:ml-auto sm:w-4/5" />
              </div>
            }
          />

          {/* Photo band */}
          <Reveal className="relative overflow-hidden rounded-[2rem]">
            <Image
              src={clinicTeam}
              alt="Clinicians talking together around a tablet"
              placeholder="blur"
              sizes="(min-width: 1280px) 1216px, 100vw"
              className="h-72 w-full object-cover sm:h-[26rem]"
            />
            <div className="bg-navy p-7 text-navy-foreground sm:p-9 lg:absolute lg:bottom-8 lg:left-8 lg:max-w-md lg:rounded-[1.5rem]">
              <p className="font-display text-2xl leading-tight font-extrabold tracking-tight sm:text-3xl">
                Made for clinics that see patients all day
              </p>
              <p className="mt-3 leading-relaxed text-navy-muted">
                Start recording in two clicks after the patient details. Recordings are saved in small parts, so
                nothing is lost if the internet drops.
              </p>
            </div>
          </Reveal>

          <FeatureRow
            id="patients"
            eyebrow="For patients"
            title="Medical reports explained in plain words"
            text="Patients upload a report or prescription as a photo or PDF and get a simple explanation. The symptom checker gives a severity level and the type of doctor to visit."
            points={["Every value shown against its normal range", "Severity: low, medium or high", "Explanations help; they do not replace a doctor"]}
            visual={
              <div className="rounded-[2rem] bg-peach p-4 sm:p-8">
                <Image
                  src={patient}
                  alt="A patient describing a headache to a doctor"
                  placeholder="blur"
                  sizes="(min-width: 1024px) 560px, 100vw"
                  className="aspect-[16/10] w-full rounded-[1.5rem] object-cover"
                />
                <div className="relative -mt-14 grid grid-cols-1 gap-4 px-2 sm:-mt-20 sm:grid-cols-2 sm:px-4">
                  <LabValuePreview />
                  <SeverityPreview />
                </div>
              </div>
            }
          />
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-24 bg-navy text-navy-foreground">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
            <Reveal className="grid gap-6 lg:grid-cols-2 lg:items-end">
              <div className="space-y-4">
                <Eyebrow className="text-brand-bright">Security</Eyebrow>
                <H2>Built the way medical software should be</H2>
              </div>
              <p className="max-w-lg text-lg leading-relaxed text-navy-muted lg:justify-self-end">
                Patient data is not shared with anyone, except the services needed to process it. The admin manages
                accounts but cannot open medical documents.
              </p>
            </Reveal>
            <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map(({ icon: Icon, title, text }, index) => (
                <Reveal
                  key={title}
                  delay={(index % 3) * 0.05}
                  className="rounded-[1.5rem] border border-navy-border bg-white/[0.04] p-7"
                >
                  <span className="flex size-11 items-center justify-center rounded-xl bg-brand-bright/15 text-brand-bright">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <h3 className="mt-6 text-lg font-bold">{title}</h3>
                  <p className="mt-2 leading-relaxed text-navy-muted">{text}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Call to action */}
        <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <Reveal className="grid gap-8 rounded-[2rem] bg-primary p-8 text-primary-foreground sm:p-12 lg:grid-cols-[1fr_auto] lg:items-center lg:p-16">
            <div className="space-y-4">
              <H2>Spend the visit with your patient</H2>
              <p className="max-w-xl text-lg opacity-90">Create your doctor account, verify your email and start.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="bg-primary-foreground text-primary hover:bg-primary-foreground/90">
                <Link href="/signup/doctor">
                  Create doctor account
                  <ArrowRight aria-hidden="true" data-icon="inline-end" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-primary-foreground/35 bg-transparent text-primary-foreground hover:border-primary-foreground/60 hover:bg-primary-foreground/10 dark:bg-transparent"
              >
                <Link href="/login">Log in</Link>
              </Button>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="bg-navy text-navy-foreground">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[2fr_1fr_1fr] lg:px-8">
          <div className="max-w-sm space-y-4">
            <Logo tone="navy" />
            <p className="leading-relaxed text-navy-muted">
              Explanations and suggestions help you understand. They do not replace a doctor’s advice.
            </p>
          </div>
          <nav aria-label="Product" className="space-y-3">
            <p className="font-semibold">Product</p>
            <a href="#how-it-works" className="block text-navy-muted hover:text-navy-foreground">How it works</a>
            <a href="#features" className="block text-navy-muted hover:text-navy-foreground">Features</a>
            <a href="#security" className="block text-navy-muted hover:text-navy-foreground">Security</a>
          </nav>
          <nav aria-label="Account" className="space-y-3">
            <p className="font-semibold">Account</p>
            <Link href="/signup/doctor" className="block text-navy-muted hover:text-navy-foreground">Doctor sign-up</Link>
            <Link href="/login" className="block text-navy-muted hover:text-navy-foreground">Log in</Link>
            <Link href="/forgot-password" className="block text-navy-muted hover:text-navy-foreground">Reset password</Link>
          </nav>
        </div>
        <div className="border-t border-navy-border">
          <p className="mx-auto max-w-7xl px-4 py-6 text-sm text-navy-muted sm:px-6 lg:px-8">© 2026 MediAssist AI</p>
        </div>
      </footer>
    </div>
  );
}
