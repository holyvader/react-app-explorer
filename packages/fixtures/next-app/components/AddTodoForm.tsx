"use client";

import { addTodo } from "@/app/actions/todos";
import { useToggle } from "@/hooks/useToggle";

export function AddTodoForm() {
  const { on, toggle } = useToggle(false);
  async function submit(formData: FormData) {
    await addTodo(formData);
    toggle();
  }
  return (
    <form action={submit}>
      <input name="title" />
      <button type="submit">Add</button>
      {on ? <span>Saved!</span> : <span>Not saved</span>}
    </form>
  );
}
