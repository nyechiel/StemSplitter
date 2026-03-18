interface Props {
  theme: "dark" | "light";
  onToggle: () => void;
}

export default function ThemeToggle({ theme, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      className="w-9 h-9 rounded-lg bg-control hover:bg-control-hover flex items-center justify-center transition-all border border-control text-lg"
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "\u{1F319}" : "\u{2600}\u{FE0F}"}
    </button>
  );
}
