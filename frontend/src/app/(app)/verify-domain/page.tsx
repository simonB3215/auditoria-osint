"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ConfirmState =
  | { kind: "working" }
  | { kind: "done"; domain: string }
  | { kind: "error"; message: string };

/** Destino del link de correo: el token viene en el fragmento, ver routes/domainVerification.ts. */
export default function ConfirmDomainPage() {
  const { dict } = useI18n();
  const t = dict.domainVerification;
  const [state, setState] = useState<ConfirmState>({ kind: "working" });
  const attempted = useRef(false);

  useEffect(() => {
    // El link es de un solo uso: el doble efecto de desarrollo no debe gastarlo.
    if (attempted.current) return;
    attempted.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);

    if (!token) {
      // El fragmento solo se puede leer en el navegador, no durante el render en servidor.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "error", message: t.confirmNoToken });
      return;
    }

    api
      .post<{ data: { domain: string } }>("/api/v1/domain-verification/confirm", { token })
      .then((res) => setState({ kind: "done", domain: res.data.data.domain }))
      .catch((err) => setState({ kind: "error", message: getApiErrorMessage(err, t.confirmFailed) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-base">{t.confirmTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {state.kind === "working" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t.confirming}
          </p>
        )}
        {state.kind === "done" && (
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            {t.confirmed.replace("{domain}", state.domain)}
          </p>
        )}
        {state.kind === "error" && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {state.message}
          </p>
        )}
        {state.kind !== "working" && (
          <Button variant="outline" size="sm" asChild className="self-start">
            <Link href="/assets/verify">{t.goToProcesses}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
