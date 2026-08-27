"use client";

import { Cookie } from "lucide-react";
import { useCookieConsent } from "@/lib/cookieConsent/context";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";

/**
 * Disparador persistente para reabrir las preferencias de cookies.
 * a.md sugería colocarlo en el footer del sitio, pero el proyecto no
 * tiene un footer global (ni en las páginas públicas ni en el shell
 * autenticado) — ver README para el detalle de esta desviación. Se
 * monta acá, dentro del provider, como un botón discreto y fijo,
 * disponible en toda la app; si en el futuro se agrega un footer real,
 * este mismo botón se puede mover ahí llamando a `openPreferences()`.
 */
export function CookiePreferencesReopenTrigger() {
  const { ready, needsDecision, openPreferences } = useCookieConsent();
  const { dict } = useI18n();
  const t = dict.cookieConsent.reopenTrigger;

  if (!ready || needsDecision) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={openPreferences}
      title={t.label}
      aria-label={t.label}
      className="fixed top-3 left-3 z-40 rounded-full bg-background/80 text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground"
    >
      <Cookie />
    </Button>
  );
}
