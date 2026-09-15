// src/app/dashboard/grootboek/page.tsx — [GROOTBOEK-KAART] thin server shell; the client fetches.
import GrootboekJaarClient from "./GrootboekJaarClient";

export const dynamic = "force-dynamic";

export default function GrootboekPage() {
  return <GrootboekJaarClient />;
}
