import { getTodos } from "@/lib/data";
import { TodoItem } from "./TodoItem";

export async function TodoList({ userId }: { userId: string }) {
  const todos = await getTodos(userId);
  return (
    <ul>
      {todos.length === 0 && <li>No todos</li>}
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </ul>
  );
}
