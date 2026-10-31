"use server";

import { db } from "@/lib/data";

export async function addTodo(formData: FormData): Promise<{ ok: boolean }> {
  const title = String(formData.get("title"));
  await db.insert(title);
  return { ok: true };
}
