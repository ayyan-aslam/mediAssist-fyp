import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { PageTransition } from "@/components/shared/page-transition";
import { ConsultationPreview, RecordingBadge } from "@/components/shared/product-previews";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import consultation from "@/public/images/consultation.jpg";

// From the design doc requirements (Section 2.2).
const FACTS = [
  { value: "15 s", label: "SOAP note after you stop" },
  { value: "2 clicks", label: "To start recording" },
  { value: "AES-256", label: "CNIC and audio" },
];

// Auth pages: the form on the left, the brand panel on the right (desktop). One column on phones and tablets.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-5 py-5 sm:px-10 lg:px-14">
        <header className="flex items-center justify-between">
          <Link href="/" aria-label="MediAssist AI home" className="rounded-lg">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center py-12 sm:py-16">
          <PageTransition className="w-full max-w-104">{children}</PageTransition>
        </main>

        <footer className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© 2026 MediAssist AI</span>
          <Link href="/" className="font-medium hover:text-foreground">
            Back to home
          </Link>
        </footer>
      </div>

      {/* At least the screen's height and taller when its content needs it, so nothing is cut off and the
          page scrolls normally on short screens. Sticky, so it stays in view next to the long sign-up form. */}
      <aside className="hidden p-3 lg:sticky lg:top-0 lg:flex lg:self-start">
        <div className="flex min-h-[calc(100dvh-1.5rem)] w-full flex-col rounded-[2rem] bg-navy p-10 text-navy-foreground xl:p-12 dark:ring-1 dark:ring-navy-border [@media(max-height:820px)]:p-8">
          <h2 className="max-w-md font-display text-[clamp(2.25rem,3.4vw,3rem)] leading-[1.02] font-extrabold tracking-[-0.035em] [@media(max-height:820px)]:text-[2.25rem]">
            Your notes are written <span className="text-brand-bright">while you listen</span>
          </h2>

          {/* The photo takes the free height; the small cards float on it and hide when the screen is short. */}
          <div className="relative mt-8 min-h-64 flex-1 overflow-hidden rounded-[1.5rem] [@media(max-height:820px)]:mt-6">
            <Image
              src={consultation}
              alt="A doctor listening to a patient at a clinic desk"
              placeholder="blur"
              fill
              sizes="(min-width: 1024px) 45vw, 0px"
              className="object-cover object-[45%_30%]"
            />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-navy/60 via-navy/5 to-transparent" />
            <RecordingBadge className="absolute top-4 left-4" />
            <ConsultationPreview
              variant="compact"
              className="absolute bottom-4 left-4 w-[min(19rem,calc(100%-2rem))] [@media(max-height:720px)]:hidden"
            />
          </div>

          <dl className="mt-8 grid shrink-0 grid-cols-3 gap-4 border-t border-navy-border pt-6 xl:gap-6 [@media(max-height:820px)]:mt-6 [@media(max-height:820px)]:pt-5">
            {FACTS.map(({ value, label }) => (
              <div key={value}>
                <dt className="font-display text-2xl font-extrabold tracking-[-0.03em] tabular-nums xl:text-3xl">{value}</dt>
                <dd className="mt-1 text-sm leading-snug text-navy-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
