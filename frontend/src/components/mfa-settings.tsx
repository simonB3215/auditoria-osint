"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface Enrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function MfaSettings() {
  const { dict } = useI18n();
  const t = dict.mfa;
  const { toast } = useToast();
  const [active, setActive] = useState<boolean | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => setActive((data?.totp?.length ?? 0) > 0));
  }, []);

  async function startEnrollment() {
    setBusy(true);
    setError(null);
    const { auth } = createClient();

    // Un intento anterior abandonado deja un factor sin verificar, que bloquea
    // volver a inscribirse.
    const { data: factors } = await auth.mfa.listFactors();
    for (const factor of factors?.all ?? []) {
      if (factor.status === "unverified") await auth.mfa.unenroll({ factorId: factor.id });
    }

    const { data, error: enrollError } = await auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (enrollError || !data) {
      setError(t.enrollFailed);
      return;
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function confirmEnrollment(e: FormEvent) {
    e.preventDefault();
    if (!enrollment) return;
    setBusy(true);
    setError(null);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code: code.trim(),
    });
    setBusy(false);
    if (verifyError) {
      setError(t.wrongCode);
      return;
    }
    setEnrollment(null);
    setActive(true);
    toast({ description: t.success, variant: "success" });
  }

  async function cancelEnrollment() {
    if (enrollment) await createClient().auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setError(null);
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          {t.title}
        </CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {active === null ? (
          <Skeleton className="h-9 w-24" />
        ) : active ? (
          <>
            <p className="text-sm font-medium">{t.active}</p>
            <p className="text-xs text-muted-foreground">{t.lostDevice}</p>
          </>
        ) : enrollment ? (
          <form onSubmit={confirmEnrollment} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t.scanInstructions}</p>
            {/* SVG en data URI generado por Supabase: next/image no aporta nada acá. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrCode} alt="" className="size-44 self-center rounded-md bg-white p-2" />
            <div className="flex flex-col gap-2">
              <Label htmlFor="mfa-secret">{t.secretLabel}</Label>
              <Input id="mfa-secret" readOnly value={enrollment.secret} className="font-mono text-xs" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="mfa-enroll-code">{t.codeLabel}</Label>
              <Input
                id="mfa-enroll-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {busy ? t.working : t.confirm}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEnrollment}>
                {t.cancel}
              </Button>
            </div>
          </form>
        ) : (
          <>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="button" disabled={busy} onClick={startEnrollment} className="self-start">
              {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t.activate}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
