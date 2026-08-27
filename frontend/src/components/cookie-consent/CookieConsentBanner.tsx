"use client";

import { useCookieConsent } from "@/lib/cookieConsent/context";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";

export function CookieConsentBanner() {
  const { ready, needsDecision, acceptAll, rejectNonEssential, openPreferences } = useCookieConsent();
  const { dict } = useI18n();
  const t = dict.cookieConsent.banner;

  if (!ready || !needsDecision) return null;

  return (
    <div
      role="region"
      aria-label={t.title}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-4 shadow-lg backdrop-blur-sm motion-safe:animate-in motion-safe:slide-in-from-bottom-4 motion-safe:fade-in-0"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{t.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={openPreferences}>
            {t.customize}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={rejectNonEssential}>
            {t.rejectNonEssential}
          </Button>
          <Button type="button" size="sm" onClick={acceptAll}>
            {t.acceptAll}
          </Button>
        </div>
      </div>
    </div>
  );
}
