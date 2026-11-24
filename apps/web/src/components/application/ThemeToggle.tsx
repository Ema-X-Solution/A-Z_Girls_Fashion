import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../app/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggleTheme);
  const toLight = theme === "dark";
  const label = toLight ? "الوضع الفاتح" : "الوضع الداكن";
  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : "theme-toggle"}
      aria-label={label}
      title={label}
      onClick={(event) => toggleTheme(event)}
    >
      {toLight ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
