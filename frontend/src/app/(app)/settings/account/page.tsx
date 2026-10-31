"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/hooks/useProfile";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MfaSettings } from "@/components/mfa-settings";

export default function AccountSettingsPage() {
  const { dict } = useI18n();
  const t = dict.settings.account;
  const { profile, loading: profileLoading } = useProfile();
  const { toast } = useToast();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const tooShort = newPassword.length > 0 && newPassword.length < 8;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (newPassword.length < 8) {
      setFormError(t.tooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError(t.mismatch);
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setFormError(error.message);
        return;
      }

      // `updateUser` ya actualiza la sesión local, pero se fuerza un
      // refresh explícito para que el nuevo access token quede propagado
      // de inmediato (a.md, sección 3: "el token de la nueva sesión
      // reemplace al anterior sin cerrar la ventana actual").
      await supabase.auth.refreshSession();

      setNewPassword("");
      setConfirmPassword("");
      toast({ description: t.success, variant: "success" });
    } catch {
      setFormError(t.updateFailed);
    } finally {
      setSaving(false);
    }
  }

  if (profileLoading) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-primary" aria-hidden />
            {t.cardTitle}
          </CardTitle>
          <CardDescription>{profile?.role ? dict.nav.roles[profile.role] : null}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-password">{t.newPassword}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={tooShort}
              />
              {tooShort && <p className="text-xs text-destructive">{t.tooShort}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm-password">{t.confirmPassword}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={mismatch}
              />
              {mismatch && <p className="text-xs text-destructive">{t.mismatch}</p>}
            </div>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={saving} className="self-start">
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {saving ? t.saving : t.save}
            </Button>
          </form>
        </CardContent>
      </Card>

      <MfaSettings />
    </div>
  );
}
