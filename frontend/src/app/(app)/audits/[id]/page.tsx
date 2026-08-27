"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, HelpCircle, History, Loader2, ScanSearch, ShieldCheck } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { Audit, ComplianceRequirement, EvidenceListResponse, EvidenceUploadResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AuditStatusBadge } from "@/components/audit-status-badge";
import { CoverageMatrix } from "@/components/coverage-matrix";
import { EvidenceUpload } from "@/components/evidence-upload";

export default function AuditDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const { dict } = useI18n();
  const t = dict.auditDetail;
  const { profile } = useProfile();
  const canWrite = profile?.role === "ciso" || profile?.role === "auditor";

  const [audit, setAudit] = useState<Audit | null>(null);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [coverage, setCoverage] = useState<EvidenceListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false);
  const [ownershipChecked, setOwnershipChecked] = useState(false);

  function loadAll() {
    setLoading(true);
    setError(null);

    api
      .get<{ data: Audit }>(`/api/v1/audits/${id}`)
      .then(async (auditRes) => {
        setAudit(auditRes.data.data);
        const [reqRes, evidencesRes] = await Promise.all([
          api.get<{ data: ComplianceRequirement[] }>(`/api/v1/frameworks/${auditRes.data.data.framework}/requirements`),
          api.get<{ data: EvidenceListResponse }>(`/api/v1/audits/${id}/evidences`),
        ]);
        setRequirements(reqRes.data.data);
        setCoverage(evidencesRes.data.data);
      })
      .catch((err) => setError(getApiErrorMessage(err, t.loadFailed)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Estado del escaneo en tiempo real (a.md: "Pending/Scanning/Completed/Failed"):
  // mientras el audit está en cola o corriendo, se refresca solo cada 3s en
  // vez de depender de que el usuario recargue la página a mano.
  useEffect(() => {
    if (audit?.status !== "queued" && audit?.status !== "running") return;
    const interval = setInterval(() => {
      api
        .get<{ data: Audit }>(`/api/v1/audits/${id}`)
        .then((res) => setAudit(res.data.data))
        .catch(() => undefined);
    }, 3000);
    return () => clearInterval(interval);
  }, [id, audit?.status]);

  function openScanConfirm() {
    if (!canWrite) {
      setScanNotice({ kind: "error", message: t.scanFailed });
      return;
    }
    setOwnershipChecked(false);
    setScanConfirmOpen(true);
  }

  async function handleRunScan() {
    setScanConfirmOpen(false);
    setScanning(true);
    setScanNotice(null);
    try {
      await api.post(`/api/v1/audits/${id}/run-scan`, {});
      setScanNotice({ kind: "success", message: t.scanQueued });
      loadAll();
    } catch (err) {
      setScanNotice({ kind: "error", message: getApiErrorMessage(err, t.scanFailed) });
    } finally {
      setScanning(false);
    }
  }

  function handleUploaded(result: EvidenceUploadResponse) {
    setCoverage((prev) => ({
      evidences: [result.evidence, ...(prev?.evidences ?? [])],
      completion_percentage: result.completion_percentage,
      missing_requirements: result.missing_requirements,
      covered_requirements: result.covered_requirements,
    }));
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (error || !audit) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? t.notFound}</AlertDescription>
      </Alert>
    );
  }

  // Los requisitos "technical" (Ley 21.663) se satisfacen por escaneo, no
  // por evidencia subida — no pertenecen a la matriz de cobertura
  // documental ni al selector de carga (ver la tarjeta ANCI en el reporte).
  const documentaryRequirements = requirements.filter((r) => r.kind !== "technical");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" aria-hidden />
              {dict.newAudit.backToDashboard}
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{audit.title}</h1>
            <p className="text-sm text-muted-foreground">{dict.dashboard.frameworks[audit.framework]}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AuditStatusBadge status={audit.status} />
          <Button asChild variant="ghost" size="sm">
            <Link href={`/audits/${id}/history`}>
              <History className="size-4" aria-hidden />
              {t.viewHistory}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={!canWrite ? "opacity-50" : undefined}
            onClick={openScanConfirm}
            disabled={scanning}
          >
            {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanSearch className="size-4" aria-hidden />}
            {scanning ? t.runningScan : t.runScanNetwork}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/audits/${id}/report`}>
              <FileText className="size-4" aria-hidden />
              {t.viewReport}
            </Link>
          </Button>
        </div>
      </div>

      {scanNotice && (
        <Alert variant={scanNotice.kind === "error" ? "destructive" : "default"}>
          <AlertDescription>{scanNotice.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.networkModuleEyebrow}</p>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-2 pt-6">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">{t.networkGuaranteeTitle}</p>
                <p className="text-sm text-muted-foreground">{t.networkGuaranteeBody}</p>
              </div>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" variant="link" size="sm" className="w-fit self-start px-0 text-xs">
                  <HelpCircle className="size-3.5" aria-hidden />
                  {t.dbPrivacyTrigger}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t.dbPrivacyTitle}</DialogTitle>
                  <DialogDescription>{t.dbPrivacyBody}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button type="button">{t.dbPrivacyClose}</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">{t.networkModuleLegend}</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.filesModuleEyebrow}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.coverageMatrix}</CardTitle>
            </CardHeader>
            <CardContent>
              {coverage && (
                <CoverageMatrix
                  requirements={documentaryRequirements}
                  coveredCodes={coverage.covered_requirements}
                  completionPercentage={coverage.completion_percentage}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.uploadEvidence}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">{t.filesModuleLegend}</p>
              <EvidenceUpload auditId={id} requirements={documentaryRequirements} onUploaded={handleUploaded} />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.uploadedEvidences}</CardTitle>
        </CardHeader>
        <CardContent>
          {coverage && coverage.evidences.length > 0 ? (
            <ul className="flex flex-col divide-y">
              {coverage.evidences.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between py-2 text-sm">
                  <div className="flex flex-col">
                    <span className="font-medium">{ev.file_name}</span>
                    {ev.requirement_code && (
                      <span className="text-xs text-muted-foreground">
                        {t.requirementPrefix} {ev.requirement_code}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {t.uploadedByPrefix} {ev.uploader_name ?? t.deletedUser}
                    </span>
                  </div>
                  <span
                    className={
                      ev.validation_status === "valid"
                        ? "text-[var(--severity-low)]"
                        : "text-[var(--severity-critical)]"
                    }
                  >
                    {ev.validation_status === "valid" ? t.valid : t.withErrors}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t.noEvidences}</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={scanConfirmOpen} onOpenChange={setScanConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.scanConfirmTitle}</DialogTitle>
            <DialogDescription>{t.scanConfirmBody}</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="ownership-declaration"
              checked={ownershipChecked}
              onCheckedChange={(checked) => setOwnershipChecked(checked === true)}
            />
            <Label htmlFor="ownership-declaration" className="text-sm font-normal leading-snug">
              {t.scanConfirmCheckbox}
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setScanConfirmOpen(false)}>
              {t.scanConfirmCancel}
            </Button>
            <Button type="button" onClick={handleRunScan} disabled={!ownershipChecked}>
              <ScanSearch className="size-4" aria-hidden />
              {t.scanConfirmProceed}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
