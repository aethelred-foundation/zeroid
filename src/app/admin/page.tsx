import { redirect } from "next/navigation";

/**
 * The previous admin screen was a static mock and did not enforce backend
 * authorization. Keep old bookmarks working while exposing only the
 * backend-backed enterprise controls.
 */
export default function AdminPage(): never {
  redirect("/enterprise");
}
