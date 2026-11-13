"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name. The visible label wraps the control, but its text would include the options. */
  ariaLabel: string;
  /** Shown while `value` matches no option. */
  placeholder?: string;
  /** Monospace text, for hashes and addresses. */
  mono?: boolean;
  disabled?: boolean;
}

/**
 * A select that follows the site's look instead of the browser's own dropdown. It implements the
 * WAI-ARIA "select-only combobox" pattern: arrow keys, Home and End, Enter or Space to choose,
 * Escape to close, type-ahead, and Tab commits the highlighted option.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  mono = false,
  disabled = false,
}: SelectProps<T>) {
  const uid = useId();
  const listId = `${uid}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", timer: undefined as ReturnType<typeof setTimeout> | undefined });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [openUp, setOpenUp] = useState(false);

  const openList = useCallback(() => {
    if (disabled || options.length === 0) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    // Open upward only when there is no room below and enough room above.
    setOpenUp(rect ? window.innerHeight - rect.bottom < 280 && rect.top > 280 : false);
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, options.length, selectedIndex]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number, refocus: boolean) => {
      const option = options[index];
      if (option && option.value !== value) onChange(option.value);
      close(refocus);
    },
    [close, onChange, options, value],
  );

  // Close on a press outside the control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted option visible inside the scrolling list.
  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }, [open, active]);

  useEffect(() => {
    const state = typed.current;
    return () => clearTimeout(state.timer);
  }, []);

  /** Index of the next option whose label starts with what the user has typed. */
  const matchTyped = (key: string, from: number): number => {
    const state = typed.current;
    clearTimeout(state.timer);
    state.text += key.toLowerCase();
    state.timer = setTimeout(() => {
      state.text = "";
    }, 600);
    const start = state.text.length === 1 ? from + 1 : from;
    for (let i = 0; i < options.length; i += 1) {
      const index = (start + i) % options.length;
      if (options[index].label.toLowerCase().startsWith(state.text)) return index;
    }
    return -1;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const last = options.length - 1;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const index = matchTyped(event.key, selectedIndex);
        if (index >= 0) onChange(options[index].value);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActive(0);
        break;
      case "End":
        event.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(active, true);
        break;
      case "Escape":
        event.preventDefault();
        close(true);
        break;
      case "Tab":
        // Like a native select: take the highlighted option and let focus move on.
        commit(active, false);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const index = matchTyped(event.key, active);
          if (index >= 0) setActive(index);
        }
    }
  };

  const monoClass = mono ? " mono" : "";

  return (
    <div ref={rootRef} className={`pselect${open ? " open" : ""}${openUp ? " up" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={`pselect-trigger${monoClass}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${uid}-opt-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className={`pselect-value${selected ? "" : " placeholder"}`}>
          {selected?.label ?? placeholder ?? ""}
        </span>
        <span className="pselect-caret" aria-hidden="true" />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          className={`pselect-list${monoClass}`}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${uid}-opt-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className={`pselect-option${index === active ? " active" : ""}${
                index === selectedIndex ? " selected" : ""
              }`}
              // Keep focus on the trigger, and stop a wrapping <label> from re-clicking it.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                commit(index, true);
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
