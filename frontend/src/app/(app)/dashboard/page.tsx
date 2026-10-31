"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon,
  FlaskConical,
  FolderKanban,
  Gauge,
  Globe,
  Loader2,
  Plus,
  Rocket,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { api, ensureSession, getApiErrorMessage } from "@/lib/api";
import type { DashboardSummary } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { SeverityDistribution } from "@/components/severity-distribution";
import { SEVERITY_VISUALS } from "@/components/severity-badge";
import type { Framework } from "@/lib/types";

/**
 * Puntaje de Salud de Seguridad (a.md, "REDISEÑO COMPLETO DE UI/UX"):
 * reemplaza el lenguaje técnico ("risk_score") por 3 etiquetas simples y
 * reusa la paleta de severidad ya validada (SEVERITY_VISUALS) en vez de
 * inventar un cuarto set de colores para lo mismo.
 */
function healthLevel(score: number, t: { excellent: string; attention: string; critical: string }) {
  if (score >= 85) return { label: t.excellent, ...SEVERITY_VISUALS.low };
  if (score >= 40) return { label: t.attention, ...SEVERITY_VISUALS.medium };
  return { label: t.critical, ...SEVERITY_VISUALS.critical };
}

function HealthScoreCard({
  score,
  t,
}: {
  score: number | null;
  t: {
    healthScoreTitle: string;
    healthScoreHint: string;
    healthScoreEmpty: string;
    healthScoreExcellent: string;
    healthScoreAttention: string;
    healthScoreCritical: string;
  };
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Gauge className="size-6" aria-hidden />
        </div>
        {score === null ? (
          <div>
            <p className="text-sm font-medium">{t.healthScoreTitle}</p>
            <p className="text-sm text-muted-foreground">{t.healthScoreEmpty}</p>
          </div>
        ) : (
          (() => {
            const level = healthLevel(score, {
              excellent: t.healthScoreExcellent,
              attention: t.healthScoreAttention,
              critical: t.healthScoreCritical,
            });
            return (
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium">{t.healthScoreTitle}</p>
                  <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: level.color }}>
                    <level.Icon className="size-4" aria-hidden />
                    {level.label}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={score} className="h-2 flex-1" />
                  <span className="w-10 text-right text-lg font-semibold tabular-nums">{score}</span>
                </div>
                <p className="text-xs text-muted-foreground">{t.healthScoreHint}</p>
              </div>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Estado vacío guiado para cuentas nuevas (a.md, "REDISEÑO COMPLETO DEL
 * DASHBOARD Y FIRST-TIME UX"): reemplaza toda la vista plana (que hoy
 * igual mostraría un 0% coherente en todas las tarjetas, ver el fix de
 * `averageCoveragePercentage`/`securityHealthScore` en el summary) por un
 * único banner de bienvenida con un solo próximo paso claro, en vez de un
 * dashboard vacío con seis tarjetas en cero.
 */
function WelcomeHero({
  t,
  onDismiss,
  onLoadSandbox,
  sandboxBusy,
}: {
  t: {
    welcomeTitle: string;
    welcomeSubtitle: string;
    welcomeCta: string;
    welcomePrivacyBadge: string;
    welcomeDismiss: string;
    sandboxLoadCta: string;
    sandboxLoading: string;
  };
  onDismiss: () => void;
  onLoadSandbox: () => void;
  sandboxBusy: boolean;
}) {
  return (
    <Card className="relative border-primary/30 bg-primary/5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute top-3 right-3 text-muted-foreground"
        onClick={onDismiss}
      >
        {t.welcomeDismiss}
      </Button>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <ShieldCheck className="size-10 text-primary" aria-hidden />
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-semibold">{t.welcomeTitle}</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{t.welcomeSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button asChild size="lg">
            <Link href="/audits/new">
              <Rocket className="size-4" aria-hidden />
              {t.welcomeCta}
            </Link>
          </Button>
          <Button type="button" variant="outline" size="lg" onClick={onLoadSandbox} disabled={sandboxBusy}>
            {sandboxBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FlaskConical className="size-4" aria-hidden />
            )}
            {sandboxBusy ? t.sandboxLoading : t.sandboxLoadCta}
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden />
          {t.welcomePrivacyBadge}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Módulo de simulación (a.md, "MODULO DE SIMULACIÓN (SANDBOX) Y
 * GENERACIÓN DE INFORME TÉCNICO COMPLETO"): deja probar el flujo completo
 * — hallazgos, descarte de falsos positivos, reporte PDF — con datos de
 * ejemplo, sin depender de un dominio real ni de un escaneo Nmap de
 * verdad. Mismo componente para los dos estados (cargar / limpiar) para
 * no duplicar el layout de la tarjeta.
 */
function SandboxControls({
  auditId,
  busy,
  onLoad,
  onRequestClean,
  t,
}: {
  auditId: string | null;
  busy: boolean;
  onLoad: () => void;
  onRequestClean: () => void;
  t: {
    sandboxTitle: string;
    sandboxHint: string;
    sandboxLoadCta: string;
    sandboxLoading: string;
    sandboxCleanCta: string;
    sandboxCleaning: string;
  };
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 pt-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FlaskConical className="size-5" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium">{t.sandboxTitle}</p>
          <p className="text-xs text-muted-foreground">{t.sandboxHint}</p>
        </div>
        {auditId ? (
          <Button type="button" variant="outline" onClick={onRequestClean} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            {busy ? t.sandboxCleaning : t.sandboxCleanCta}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={onLoad} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FlaskConical className="size-4" aria-hidden />}
            {busy ? t.sandboxLoading : t.sandboxLoadCta}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const HERO_DISMISSED_KEY = "aegis-dashboard-hero-dismissed";

export default function DashboardPage() {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.dashboard;
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // a.md, "FIX CONDICIONAL DE BIENVENIDA": el hero es útil la primera vez,
  // pero no debe ser la única forma de llegar al dashboard tradicional
  // mientras la cuenta siga sin auditorías — se persiste en localStorage
  // (mismo patrón que "aegis-theme") para que no vuelva a aparecer tras
  // recargar la página.
  const [heroDismissed, setHeroDismissed] = useState(false);
  useEffect(() => {
    setHeroDismissed(window.localStorage.getItem(HERO_DISMISSED_KEY) === "true");
  }, []);

  const [newAuditTitle, setNewAuditTitle] = useState("");
  // Ley 21.663 (ANCI) por defecto (a.md, "REDISEÑO COMPLETO DEL DASHBOARD"):
  // es el framework con el módulo técnico automático (escaneo sin
  // archivos), el camino de menor fricción para una primera auditoría.
  const [newAuditFramework, setNewAuditFramework] = useState<Framework>("ley_21663_cl");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [sandboxAuditId, setSandboxAuditId] = useState<string | null>(null);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const [sandboxConfirmOpen, setSandboxConfirmOpen] = useState(false);

  const FRAMEWORKS: { value: Framework; label: string }[] = [
    { value: "iso27001", label: t.frameworks.iso27001 },
    { value: "nist_csf", label: t.frameworks.nist_csf },
    { value: "gdpr", label: t.frameworks.gdpr },
    { value: "local_dp_law", label: t.frameworks.local_dp_law },
    { value: "ley_21663_cl", label: t.frameworks.ley_21663_cl },
  ];

  function loadSummary() {
    setLoading(true);
    api
      .get<{ data: DashboardSummary }>("/api/v1/dashboard/summary")
      .then((res) => setSummary(res.data.data))
      .catch((err) => setError(getApiErrorMessage(err, t.loadFailed)))
      .finally(() => setLoading(false));
  }

  function loadSandboxStatus() {
    api
      .get<{ data: { auditId: string | null } }>("/api/v1/audits/sandbox")
      .then((res) => setSandboxAuditId(res.data.data.auditId))
      .catch(() => undefined);
  }

  useEffect(() => {
    let cancelled = false;
    // a.md, "fix manejo de autenticación y redirección 401": no disparar
    // /dashboard/summary hasta confirmar que el cliente de Supabase ya
    // hidrató la sesión, para no mandar la request sin token todavía.
    ensureSession().then((hasSession) => {
      if (!cancelled && hasSession) {
        loadSummary();
        loadSandboxStatus();
      } else if (!cancelled) {
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLoadSandbox() {
    setSandboxBusy(true);
    setSandboxError(null);
    try {
      const res = await api.post<{ data: { auditId: string } }>("/api/v1/audits/sandbox");
      router.push(`/audits/${res.data.data.auditId}`);
    } catch (err) {
      setSandboxError(getApiErrorMessage(err, t.sandboxLoadFailed));
      setSandboxBusy(false);
    }
  }

  async function handleCleanSandbox() {
    setSandboxBusy(true);
    setSandboxError(null);
    try {
      await api.delete("/api/v1/audits/sandbox");
      setSandboxConfirmOpen(false);
      setSandboxAuditId(null);
      loadSummary();
    } catch (err) {
      setSandboxError(getApiErrorMessage(err, t.sandboxCleanFailed));
    } finally {
      setSandboxBusy(false);
    }
  }

  async function handleCreateAudit(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await api.post<{ data: { id: string } }>("/api/v1/audits", {
        title: newAuditTitle,
        framework: newAuditFramework,
      });
      router.push(`/audits/${res.data.data.id}`);
    } catch (err) {
      setCreateError(getApiErrorMessage(err, t.createAuditFailed));
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (error || !summary) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? t.loadFailed}</AlertDescription>
      </Alert>
    );
  }

  if (summary.totalAudits === 0 && !heroDismissed) {
    return (
      <div className="flex flex-col gap-4">
        <WelcomeHero
          t={t}
          onDismiss={() => {
            window.localStorage.setItem(HERO_DISMISSED_KEY, "true");
            setHeroDismissed(true);
          }}
          onLoadSandbox={handleLoadSandbox}
          sandboxBusy={sandboxBusy}
        />
        {sandboxError && (
          <Alert variant="destructive">
            <AlertDescription>{sandboxError}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {summary.findingsBySeverity.critical > 0 && (
        <Alert variant="destructive">
          <AlertOctagon className="size-4" aria-hidden />
          <AlertDescription>
            {t.criticalBanner.replace("{count}", String(summary.findingsBySeverity.critical))}
          </AlertDescription>
        </Alert>
      )}

      <HealthScoreCard score={summary.securityHealthScore} t={t} />

      <SandboxControls
        auditId={sandboxAuditId}
        busy={sandboxBusy}
        onLoad={handleLoadSandbox}
        onRequestClean={() => setSandboxConfirmOpen(true)}
        t={t}
      />
      {sandboxError && (
        <Alert variant="destructive">
          <AlertDescription>{sandboxError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Globe} label={t.statNetworkAssets} value={summary.networkAssetsCount} />
        <StatCard
          icon={ShieldCheck}
          label={t.statAnciCompliance}
          value={summary.anciCompliance ? `${summary.anciCompliance.sePercentage}%` : t.statAnciEmpty}
          hint={summary.anciCompliance ? t.statAnciHint : undefined}
        />
        <StatCard icon={ShieldOff} label={t.statIgnoredFindings} value={summary.ignoredFindingsCount} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.riskDistribution}</CardTitle>
          </CardHeader>
          <CardContent>
            <SeverityDistribution counts={summary.findingsBySeverity} />
            {summary.osintFindingsCount > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t.osintFindingsNote.replace("{count}", String(summary.osintFindingsCount))}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t.newAudit}</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/audits/new">{t.newAuditWithAssets}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateAudit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">{t.title}</Label>
                <Input
                  id="title"
                  required
                  value={newAuditTitle}
                  onChange={(e) => setNewAuditTitle(e.target.value)}
                  placeholder={t.titlePlaceholder}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="framework">{t.framework}</Label>
                <Select value={newAuditFramework} onValueChange={(v) => setNewAuditFramework(v as Framework)}>
                  <SelectTrigger id="framework" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FRAMEWORKS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs text-muted-foreground">{t.newAuditModulesNote}</p>

              {createError && (
                <Alert variant="destructive">
                  <AlertDescription>{createError}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={creating}>
                <Plus className="size-4" aria-hidden />
                {creating ? t.creating : t.createAudit}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.recentAudits}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {summary.recentAudits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noAudits}</p>
          ) : (
            summary.recentAudits.map((audit) => (
              <Link
                key={audit.id}
                href={`/audits/${audit.id}`}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-muted/60"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-medium">{audit.title}</span>
                  <span className="text-xs text-muted-foreground">{t.frameworks[audit.framework]}</span>
                </div>
                <div className="flex items-center gap-3">
                  {audit.risk_score !== null && (
                    <div className="flex w-24 items-center gap-2">
                      <Progress value={audit.risk_score} className="h-1.5" />
                      <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                        {audit.risk_score}
                      </span>
                    </div>
                  )}
                  <AuditStatusBadge status={audit.status} />
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={sandboxConfirmOpen} onOpenChange={(open) => !sandboxBusy && setSandboxConfirmOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.sandboxConfirmTitle}</DialogTitle>
            <DialogDescription>{t.sandboxConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSandboxConfirmOpen(false)} disabled={sandboxBusy}>
              {t.sandboxConfirmCancel}
            </Button>
            <Button type="button" variant="destructive" onClick={handleCleanSandbox} disabled={sandboxBusy}>
              {sandboxBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
              {sandboxBusy ? t.sandboxCleaning : t.sandboxConfirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
