"use client";

import { useState } from "react";
import type { Todo } from "@/lib/data";
import { formatTitle } from "@/lib/format";

export function TodoItem({ todo }: { todo: Todo }) {
  const [done, setDone] = useState(todo.done);
  const toggle = (next: boolean): void => setDone(next);
  return (
    <li>
      <input type="checkbox" checked={done} onChange={(e) => toggle(e.target.checked)} />
      <span>{formatTitle(todo.title)}</span>
    </li>
  );
}
