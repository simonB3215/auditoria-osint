"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/lib/api";
import { savePostAuthPath, takePostAuthPath } from "@/lib/post-auth-path";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GoogleSignInButton } from "@/components/google-signin-button";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LoginPage() {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.auth.login;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "oauth_failed") {
      setError(t.oauthFailed);
    } else if (params.get("reason") === "session_expired") {
      setError(t.sessionExpired);
    }
    // El link de correo de un dominio llega acá sin sesión: el navegador
    // conserva el fragmento (#token=...) en la redirección del middleware.
    if (window.location.hash.startsWith("#token=")) {
      savePostAuthPath(`/verify-domain${window.location.hash}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (signInError) {
      setError(signInError.message === "Invalid login credentials" ? t.wrongCredentials : signInError.message);
      // Best-effort: el login pega directo a Supabase Auth, no a nuestro
      // backend, así que esta es la única forma de dejar registro del
      // fallo en audit_logs (a.md, sección 4). Nunca debe bloquear ni
      // demorar el feedback al usuario si falla.
      api.post("/api/v1/auth/log-failure", { email, reason: signInError.message }).catch(() => {});
      return;
    }

    router.push(takePostAuthPath() ?? "/dashboard");
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
          <CardTitle>{dict.common.appName}</CardTitle>
          <CardDescription>{t.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t.password}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? t.submitting : t.submit}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            {dict.common.or}
            <div className="h-px flex-1 bg-border" />
          </div>

          <GoogleSignInButton />

          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t.noAccount}{" "}
            <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
              {t.registerLink}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
