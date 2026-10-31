export class TodoStore {
  items: string[] = [];
  add(title: string): number {
    return this.items.push(title);
  }
}

export function createStore(): TodoStore {
  return new TodoStore();
}

// Module-level invocation.
export const store = createStore();
