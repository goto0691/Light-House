"use client";

import { useState } from "react";

type HabitConfigFormProps = {
  disabled?: boolean;
  onSubmit: (input: { title: string; icon: string }) => void;
};

export function HabitConfigForm({ disabled, onSubmit }: HabitConfigFormProps) {
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("•");

  return (
    <div className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-primary">Habit Config</p>
      <h1 className="mt-3 font-display text-3xl text-foreground">활성 습관 관리</h1>
      <div className="mt-4 space-y-3">
        <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setTitle(event.target.value)} placeholder="습관 이름" value={title} />
        <input className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-foreground" onChange={(event) => setIcon(event.target.value)} placeholder="아이콘" value={icon} />
        <button
          className="rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          disabled={disabled || !title.trim()}
          onClick={() => {
            onSubmit({ title, icon });
            setTitle("");
          }}
          type="button"
        >
          습관 추가
        </button>
      </div>
    </div>
  );
}
