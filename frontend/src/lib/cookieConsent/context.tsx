"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { allAcceptedSelections, defaultSelections } from "./categories";
import { readConsentCookieFromDocument, reconcileConsent, writeConsentCookieToDocument } from "./cookie";
import type { CookieCategoryId, ConsentSelections } from "./types";
import { CookieConsentBanner } from "@/components/cookie-consent/CookieConsentBanner";
import { CookiePreferencesDialog } from "@/components/cookie-consent/CookiePreferencesDialog";
import { CookiePreferencesReopenTrigger } from "@/components/cookie-consent/CookiePreferencesReopenTrigger";

interface CookieConsentContextValue {
  /** true una vez que se leyó la cookie en el cliente — antes de eso no se debe renderizar el banner (evita hydration mismatch). */
  ready: boolean;
  /** true si el usuario todavía no tomó una decisión (cookie ausente o de un esquema anterior). */
  needsDecision: boolean;
  selections: ConsentSelections;
  isPreferencesOpen: boolean;
  acceptAll: () => void;
  rejectNonEssential: () => void;
  savePreferences: (next: ConsentSelections) => void;
  openPreferences: () => void;
  closePreferences: () => void;
}

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [needsDecision, setNeedsDecision] = useState(false);
  const [selections, setSelections] = useState<ConsentSelections>(defaultSelections());
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);

  useEffect(() => {
    const { needsDecision: needsDecisionNow, selections: reconciled } = reconcileConsent(readConsentCookieFromDocument());
    setSelections(reconciled);
    setNeedsDecision(needsDecisionNow);
    setReady(true);
  }, []);

  const persist = useCallback((next: ConsentSelections) => {
    writeConsentCookieToDocument(next);
    setSelections(next);
    setNeedsDecision(false);
    setIsPreferencesOpen(false);
  }, []);

  const acceptAll = useCallback(() => persist(allAcceptedSelections()), [persist]);
  const rejectNonEssential = useCallback(() => persist(defaultSelections()), [persist]);
  const savePreferences = useCallback((next: ConsentSelections) => persist(next), [persist]);
  const openPreferences = useCallback(() => setIsPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setIsPreferencesOpen(false), []);

  const value: CookieConsentContextValue = {
    ready,
    needsDecision,
    selections,
    isPreferencesOpen,
    acceptAll,
    rejectNonEssential,
    savePreferences,
    openPreferences,
    closePreferences,
  };

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
      <CookieConsentBanner />
      <CookiePreferencesDialog />
      <CookiePreferencesReopenTrigger />
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent(): CookieConsentContextValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) throw new Error("useCookieConsent debe usarse dentro de <CookieConsentProvider>");
  return ctx;
}

/**
 * Helper para condicionar la carga de un recurso a que el usuario haya
 * dado consentimiento para una categoría. Antes de `ready`, o si la
 * categoría todavía no fue consentida, devuelve `false` (falla cerrado).
 *
 * Enganche futuro de analítica: cuando exista un script de analítica,
 * envolver su carga (ej. un `next/script`) en
 * `if (useHasConsent("analytics")) { ... }` dentro de un client
 * component — no cargar el script mientras esto sea `false`.
 */
export function useHasConsent(categoryId: CookieCategoryId): boolean {
  const { ready, selections } = useCookieConsent();
  return ready && selections[categoryId] === true;
}
