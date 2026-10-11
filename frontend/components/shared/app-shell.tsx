"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { navByArea, type Area } from "@/components/shared/nav-config";
import { isNavActive, SidebarNav } from "@/components/shared/sidebar-nav";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { UserMenu } from "@/components/shared/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const AREA_LABEL: Record<Area, string> = { doctor: "Doctor" };

// Header, side menu and content area. Below the lg breakpoint (phones and tablets)
// the side menu becomes a slide-in drawer.
export function AppShell({ area, children }: { area: Area; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const nav = navByArea[area];
  const homeHref = nav[0].href;
  const current = nav.find((item) => isNavActive(nav, item.href, pathname));

  return (
    <div className="min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-68 flex-col border-r bg-sidebar lg:flex">
        <div className="flex h-18 items-center px-6">
          <Link href={homeHref} aria-label="MediAssist AI home" className="rounded-lg">
            <Logo />
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <SidebarNav items={nav} />
        </div>
        <div className="m-4 rounded-2xl bg-mint p-4 text-mint-foreground">
          <p className="text-sm font-bold">{AREA_LABEL[area]} module</p>
          <p className="mt-1 text-xs leading-relaxed opacity-80">Patients, recording and SOAP notes arrive in the next release.</p>
        </div>
      </aside>

      <div className="lg:pl-68">
        <header className="sticky top-0 z-20 flex h-18 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-lg sm:px-6 lg:px-10">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" aria-label="Open menu">
                <Menu aria-hidden="true" className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0">
              <SheetHeader className="h-18 flex-row items-center px-6">
                <SheetTitle>
                  <Logo />
                </SheetTitle>
                <SheetDescription className="sr-only">Main menu</SheetDescription>
              </SheetHeader>
              <div className="px-4 py-4">
                <SidebarNav items={nav} onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <Link href={homeHref} className="lg:hidden" aria-label="MediAssist AI home">
            <Logo />
          </Link>

          <p className="hidden items-center gap-2 lg:flex">
            <span className="text-muted-foreground">{AREA_LABEL[area]}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="font-semibold">{current?.label}</span>
          </p>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12">{children}</main>
      </div>
    </div>
  );
}
