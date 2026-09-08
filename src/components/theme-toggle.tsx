"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("neximail-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    window.localStorage.setItem("neximail-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="grid h-9 w-9 place-items-center rounded-xl border border-black/8 bg-white text-zinc-700 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:bg-zinc-50 dark:border-white/10 dark:bg-[#171717] dark:text-zinc-200 dark:hover:bg-[#202020]"
    >
      {theme === "dark" ? <Sun className="h-[17px] w-[17px]" strokeWidth={1.9} /> : <Moon className="h-[17px] w-[17px]" strokeWidth={1.9} />}
    </button>
  );
}
