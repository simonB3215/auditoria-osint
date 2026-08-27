"use client";

import { useEffect, useState } from "react";
import { COOKIE_CATEGORIES } from "@/lib/cookieConsent/categories";
import { useCookieConsent } from "@/lib/cookieConsent/context";
import type { ConsentSelections } from "@/lib/cookieConsent/types";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function CookiePreferencesDialog() {
  const { ready, selections, isPreferencesOpen, closePreferences, acceptAll, savePreferences } = useCookieConsent();
  const { dict } = useI18n();
  const t = dict.cookieConsent.dialog;
  const categoryText = dict.cookieConsent.categories;

  const [draft, setDraft] = useState<ConsentSelections>(selections);

  // El panel se puede abrir desde el banner o desde el disparador
  // persistente; en ambos casos arranca reflejando la última decisión
  // guardada, no un estado en blanco.
  useEffect(() => {
    if (isPreferencesOpen) setDraft(selections);
  }, [isPreferencesOpen, selections]);

  if (!ready) return null;

  return (
    <Dialog open={isPreferencesOpen} onOpenChange={(open) => !open && closePreferences()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {t.description}{" "}
            {/* TODO: crear /legal/cookies (o apuntar a la Política de Privacidad) cuando la ruta pública exista */}
            <a href="/legal/cookies" className="underline underline-offset-2">
              {t.policyLink}
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {COOKIE_CATEGORIES.map((category) => {
            const text = categoryText[category.id];
            const inputId = `cookie-category-${category.id}`;
            return (
              <div key={category.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <Label htmlFor={inputId} className="text-sm font-medium text-foreground">
                    {text.label}
                    {category.required && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                        {t.requiredBadge}
                      </span>
                    )}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">{text.description}</p>
                </div>
                <Switch
                  id={inputId}
                  checked={draft[category.id]}
                  disabled={category.required}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, [category.id]: category.required ? true : checked }))
                  }
                  aria-label={text.label}
                />
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={acceptAll}>
            {t.acceptAll}
          </Button>
          <Button type="button" onClick={() => savePreferences(draft)}>
            {t.saveSelection}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
