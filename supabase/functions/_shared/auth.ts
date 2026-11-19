import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Returns the signed-in Kellogg user + an admin client, or a Response to send back. */
export async function requireKellogg(req: Request): Promise<
  { user: { id: string; email: string }; admin: SupabaseClient } | Response
> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await userClient.auth.getUser();
  const email = data?.user?.email?.toLowerCase() ?? "";
  if (error || !data?.user || !email.endsWith("@kellogg.northwestern.edu")) {
    return json({ error: "Only signed-in @kellogg.northwestern.edu users can do this." }, 401);
  }
  return { user: { id: data.user.id, email }, admin: createClient(url, service) };
}
