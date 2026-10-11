"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#security", label: "Security" },
];

export function LandingHeader() {
  const { user, status } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  // A hairline under the header once the page scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b bg-background/90 backdrop-blur-lg transition-colors",
        scrolled ? "border-border" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-18 max-w-7xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="MediAssist AI home" className="mr-auto rounded-lg">
          <Logo />
        </Link>

        <nav aria-label="Page sections" className="mr-4 hidden items-center gap-1 md:flex">
          {LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              className="rounded-lg px-3.5 py-2 text-[0.95rem] font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="hidden sm:block">
          <ThemeToggle />
        </div>

        {status === "authenticated" && user ? (
          <Button asChild>
            <Link href={`/${user.role}`}>Open dashboard</Link>
          </Button>
        ) : (
          <>
            <Button asChild variant="ghost" className="hidden px-4 sm:inline-flex">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild className="px-4 sm:px-5">
              <Link href="/signup/doctor">Get started</Link>
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
