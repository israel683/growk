"use client";

import { useState } from "react";

export type StackedOption = {
  value: string;
  label: string;
  description?: string;
};

export function StackedQuestion({
  question,
  options,
  multi,
  onAnswer,
  disabled,
}: {
  question: string;
  options: StackedOption[];
  multi?: boolean;
  onAnswer: (text: string) => void;
  disabled?: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function toggle(v: string) {
    if (disabled) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(v)) next.delete(v);
        else next.add(v);
      } else {
        next.clear();
        next.add(v);
      }
      return next;
    });
  }

  function submit() {
    if (picked.size === 0 || disabled) return;
    const chosen = options.filter((o) => picked.has(o.value));
    // Send the LABELS as the user reply text (Hebrew, natural). Internal
    // values are conveyed to the AI via context — the labels speak for
    // themselves and feel like a real reply in the chat.
    onAnswer(chosen.map((o) => o.label).join(" · "));
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 my-2 max-w-md">
      <p className="font-medium text-sm leading-relaxed mb-3">{question}</p>
      <ul className="space-y-2">
        {options.map((opt) => {
          const isPicked = picked.has(opt.value);
          return (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => toggle(opt.value)}
                disabled={disabled}
                className={`w-full text-right rounded-lg border p-3 transition-colors flex items-start gap-3 ${
                  isPicked
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                    : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <span
                  className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-${
                    multi ? "sm" : "full"
                  } border-2 shrink-0 ${
                    isPicked
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {isPicked && (
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                      {multi ? (
                        <path
                          d="M2 6l2.5 2.5L10 3.5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : (
                        <circle cx="6" cy="6" r="2" fill="currentColor" />
                      )}
                    </svg>
                  )}
                </span>
                <div className="flex-1">
                  <div className="text-sm font-medium leading-snug">{opt.label}</div>
                  {opt.description && (
                    <div className="text-xs text-zinc-500 mt-0.5 leading-snug">
                      {opt.description}
                    </div>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-zinc-400">
          {multi ? "ניתן לבחור יותר מאחד" : "בחירה אחת"}
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={picked.size === 0 || disabled}
          className="text-sm bg-emerald-600 text-white px-4 py-1.5 rounded-lg hover:bg-emerald-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 disabled:cursor-not-allowed"
        >
          שלח תשובה
        </button>
      </div>
    </div>
  );
}
