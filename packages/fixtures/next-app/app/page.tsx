import { Suspense } from "react";
import { getUser } from "@/lib/data";
import { TodoList } from "@/components/TodoList";
import { AddTodoForm } from "@/components/AddTodoForm";

export default async function HomePage() {
  const user = await getUser();
  if (!user) {
    return <p className="empty">Please log in</p>;
  }
  return (
    <main>
      <h1>Hello {user.name}</h1>
      {user.isAdmin && <a href="/dashboard">Dashboard</a>}
      <Suspense fallback={<span>Loading…</span>}>
        <TodoList userId={user.id} />
      </Suspense>
      <AddTodoForm />
    </main>
  );
}
