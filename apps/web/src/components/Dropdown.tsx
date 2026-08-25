import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * A themed stand-in for a native <select>. Browsers own the popup chrome of a real <select> —
 * the hover/selected highlight in particular is OS accent color and can't be restyled via CSS
 * in most engines, so a native select can never fully match the rest of the gold theme. This
 * is a real listbox (button + positioned list) instead, so every pixel of it is ours.
 */
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className ?? ""}`} ref={rootRef}>
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((next) => !next)}
      >
        <span>{current?.label ?? ""}</span>
        <ChevronDown size={14} className="dropdown-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul className="dropdown-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "selected" : ""}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
