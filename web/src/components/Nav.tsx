"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SystemSwitcher } from "./SystemSwitcher";

const LINKS = [
  { href: "/", label: "שיחה" },
  { href: "/state", label: "מצב" },
  { href: "/decisions", label: "החלטות" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-zinc-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/60 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-6">
        <Link href="/" className="font-bold text-base">
          GrowK
        </Link>
        <ul className="flex gap-4 text-sm flex-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className={`px-1 py-2 border-b-2 transition-colors ${
                    active
                      ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  }`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <SystemSwitcher />
      </div>
    </nav>
  );
}
