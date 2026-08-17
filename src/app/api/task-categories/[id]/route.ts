import { z } from "zod";
import { taskCategorySchema } from "@/lib/server/schemas";
import { ApiError, assertDatabase, authed, noContent, ok, parseJson, withApi } from "@/lib/server/http";

const idSchema = z.uuid();
type Context = { params: Promise<{ id: string }> };

function assertCategoryMutation<T>(result: { data: T; error: { message: string; code?: string } | null }) {
  if (result.error?.code === "23505") {
    throw new ApiError(409, "You already have a category with that name.", "category_exists");
  }
  if (result.error?.code === "P0002") {
    throw new ApiError(404, "Task category not found.", "not_found");
  }
  return assertDatabase(result);
}

export async function PATCH(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const id = idSchema.parse((await params).id);
    const input = await parseJson(request, taskCategorySchema);
    const result = await supabase.rpc("rename_task_category", {
      p_category_id: id,
      p_name: input.name,
    });
    return ok(assertCategoryMutation(result));
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return withApi(async () => {
    const { supabase } = await authed(request);
    const id = idSchema.parse((await params).id);
    assertCategoryMutation(await supabase.rpc("delete_task_category", { p_category_id: id }));
    return noContent();
  });
}
