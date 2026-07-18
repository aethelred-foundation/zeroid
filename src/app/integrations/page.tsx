import { redirect } from "next/navigation";

/**
 * API keys and webhooks are the supported integration surfaces. Redirect the
 * former static catalogue to their backend-backed enterprise console.
 */
export default function IntegrationsPage(): never {
  redirect("/enterprise");
}
