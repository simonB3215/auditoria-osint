"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { takePostAuthPath } from "@/lib/post-auth-path";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LanguageSwitcher } from "@/components/language-switcher";

/** Segundo paso del login para quien ya tiene 2FA activo: ver el layout de /(app). */
export default function MfaChallengePage() {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.mfa;
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        const factor = data?.totp?.[0];
        if (factor) {
          setFactorId(factor.id);
        } else {
          router.replace("/dashboard");
        }
      });
  }, [router]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);

    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setLoading(false);

    if (verifyError) {
      setError(t.wrongCode);
      return;
    }

    router.replace(takePostAuthPath() ?? "/dashboard");
    router.refresh();
  }

  async function handleLogout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShieldCheck className="mb-2 size-8 text-primary" aria-hidden />
          <CardTitle>{t.challengeTitle}</CardTitle>
          <CardDescription>{t.challengeSubtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="mfa-code">{t.codeLabel}</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading || !factorId} className="w-full">
              {loading ? t.working : t.challengeSubmit}
            </Button>
            <Button type="button" variant="ghost" onClick={handleLogout} className="w-full">
              {t.logout}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
