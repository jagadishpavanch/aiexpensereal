import { useEffect } from "react";
import { useFinance } from "@/lib/finance/store";

export function ThemeSync() {
  const theme = useFinance((s) => s.prefs.theme);
  const accent = useFinance((s) => s.prefs.accent);
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => root.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    if (accent === "peacock") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", accent);
    return () => mq.removeEventListener("change", apply);
  }, [theme, accent]);
  return null;
}
