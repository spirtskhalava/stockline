"use client";

import { useState, useTransition } from "react";

export function ActionButton({ label, action }: { label: string; action: () => Promise<string> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  return (
    <span className="action">
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              setResult(await action());
            } catch (e) {
              setResult((e as Error).message);
            }
          })
        }
      >
        {pending ? "…" : label}
      </button>
      {result && <small>{result}</small>}
    </span>
  );
}
