"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/components/shared/nav-config";
import { cn } from "@/lib/utils";

const itemClass = "flex h-11 items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium transition-colors";

// The area home (first item) is active only on its exact path.
export function isNavActive(items: NavItem[], href: string, pathname: string) {
  return href === items[0].href ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main menu" className="space-y-1">
      <p className="px-3 pb-2 text-xs font-semibold text-muted-foreground">Workspace</p>
      {items.map(({ href, label, icon: Icon, soon }) => {
        if (soon) {
          return (
            <span key={href} aria-disabled="true" className={cn(itemClass, "cursor-not-allowed text-muted-foreground")}>
              <Icon aria-hidden="true" className="size-5" />
              {label}
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Soon</span>
            </span>
          );
        }
        const active = isNavActive(items, href, pathname);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              itemClass,
              active
                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : "text-foreground/75 hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
