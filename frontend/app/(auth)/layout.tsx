import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { PageTransition } from "@/components/shared/page-transition";
import { ConsultationPreview } from "@/components/shared/product-previews";
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

      <aside className="hidden p-3 lg:sticky lg:top-0 lg:block lg:h-dvh lg:self-start">
        <div className="flex h-full flex-col overflow-hidden rounded-[2rem] bg-navy p-10 text-navy-foreground xl:p-12 dark:ring-1 dark:ring-navy-border">
          <h2 className="max-w-md font-display text-[2.6rem] leading-[1.02] font-extrabold tracking-[-0.035em] xl:text-5xl">
            Your notes are written <span className="text-brand-bright">while you listen</span>
          </h2>

          <div className="relative mt-8 min-h-0 flex-1">
            <Image
              src={consultation}
              alt="A doctor listening to a patient at a clinic desk"
              placeholder="blur"
              sizes="(min-width: 1024px) 45vw, 0px"
              className="h-full max-h-88 w-full rounded-[1.5rem] object-cover"
            />
            <div className="absolute right-4 -bottom-2 w-[min(22rem,85%)] xl:right-8">
              <ConsultationPreview variant="panel" />
            </div>
          </div>

          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-navy-border pt-6">
            {FACTS.map(({ value, label }) => (
              <div key={value}>
                <dt className="font-display text-3xl font-extrabold tracking-[-0.03em] tabular-nums">{value}</dt>
                <dd className="mt-1 text-sm leading-snug text-navy-muted">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
