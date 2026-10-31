import "server-only";

export interface User { id: string; name: string; isAdmin: boolean }
export interface Todo { id: string; title: string; done: boolean }

export async function getUser(): Promise<User | null> {
  return { id: "1", name: "Ada", isAdmin: true };
}

export async function getTodos(userId: string): Promise<Todo[]> {
  return [{ id: "t1", title: `todo of ${userId}`, done: false }];
}

export const db = { insert: async (title: string) => title.length };
