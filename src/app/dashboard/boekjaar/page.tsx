// src/app/dashboard/boekjaar/page.tsx
// [VAKWOORD] Het woord dat een boekhouder typt, op het scherm dat het al beantwoordt.
// Hier: het jaar als geheel, met de auditfile ['Jaaroverzicht']
//
// De koppeling zelf staat NIET in dit bestand maar in src/lib/vakwoorden.ts, zodat elf deuren één
// lijst delen en een gate kan nakijken dat de lijst en de mappen elkaar dekken.
import { redirect } from "next/navigation";
import { vakwoordNaar } from "@/lib/vakwoorden";

export const dynamic = "force-dynamic";

export default function Page() {
  // Nooit een vaste string hier: een deur die zijn eigen bestemming bijhoudt, drijft weg van de
  // lijst die zegt waar hij heen gaat.
  redirect(vakwoordNaar("boekjaar") ?? "/dashboard");
}
