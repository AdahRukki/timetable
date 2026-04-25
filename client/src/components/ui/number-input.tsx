import { forwardRef, useEffect, useRef, useState } from "react";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  "data-testid"?: string;
  "aria-label"?: string;
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    { value, onChange, min, max, step = 1, disabled, className, placeholder, id, ...rest },
    ref,
  ) {
    const [text, setText] = useState<string>(String(value));
    const editingRef = useRef(false);

    useEffect(() => {
      if (!editingRef.current) {
        setText(String(value));
      }
    }, [value]);

    const commit = (raw: string) => {
      editingRef.current = false;
      const trimmed = raw.trim();
      if (trimmed === "" || trimmed === "-") {
        const fallback = clampInt(min, min, max);
        setText(String(fallback));
        if (fallback !== value) onChange(fallback);
        return;
      }
      const parsed = Number(trimmed);
      const clamped = clampInt(parsed, min, max);
      setText(String(clamped));
      if (clamped !== value) onChange(clamped);
    };

    return (
      <Input
        ref={ref}
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        className={cn("text-center", className)}
        onFocus={(e) => {
          editingRef.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          editingRef.current = true;
          const raw = e.target.value;
          if (raw === "") {
            setText("");
            return;
          }
          // Strip anything that isn't a digit or leading minus sign
          const cleaned = raw.replace(/(?!^-)[^\d]/g, "");
          if (cleaned === "" || cleaned === "-") {
            setText(cleaned);
            return;
          }
          const parsed = Number(cleaned);
          if (!Number.isFinite(parsed)) {
            setText(cleaned);
            return;
          }
          // Clamp on every change so the visible value can never exceed the
          // declared max — fixes the "stuck on max" feel where typing another
          // digit would overflow then snap back on blur.
          const clamped = clampInt(parsed, min, max);
          setText(String(clamped));
          if (clamped !== value) onChange(clamped);
        }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        {...rest}
      />
    );
  },
);
