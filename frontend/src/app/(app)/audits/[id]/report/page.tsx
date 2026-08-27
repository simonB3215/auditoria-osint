"use client";

import { useEffect, useMemo, useState, use as usePromise } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Eye, Loader2, MoreHorizontal, ShieldOff, CheckCircle2, RotateCcw } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { AnciStatus, AuditReport, Finding, FindingSeverity, FindingStatus, EvidenceListResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SeverityBadge } from "@/components/severity-badge";
import { FindingStatusBadge } from "@/components/finding-status-badge";

interface PendingStatusChange {
  findingId: string;
  status: FindingStatus;
}

export default function AuditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const { dict } = useI18n();
  const t = dict.report;
  const { profile } = useProfile();
  const canReview = profile?.role === "ciso" || profile?.role === "auditor";

  const SEVERITY_TABS: { value: FindingSeverity | "all"; label: string }[] = [
    { value: "all", label: t.severityAll },
    { value: "critical", label: t.severityCritical },
    { value: "high", label: t.severityHigh },
    { value: "medium", label: t.severityMedium },
    { value: "low", label: t.severityLow },
  ];

  const IGNORED_STATUSES: FindingStatus[] = ["false_positive", "accepted_risk"];
  const STATUS_TABS: { value: "active" | "ignored"; label: string }[] = [
    { value: "active", label: t.tabActiveFindings },
    { value: "ignored", label: t.tabIgnoredAlerts },
  ];

  // Modal híbrido de falsos positivos (a.md, "MVP: REGLAS DE NEGOCIO..."):
  // motivos predefinidos que precargan la justificación, más el texto
  // libre que ya existía — se puede editar/completar el texto precargado,
  // nunca reemplaza la validación de mínimo 10 caracteres que ya exigía
  // el endpoint.
  const REASON_PRESETS: { value: string; label: string; template: string }[] = [
    { value: "accepted_risk", label: t.reasonAcceptedRisk, template: t.reasonAcceptedRiskTemplate },
    { value: "compensating_control", label: t.reasonCompensatingControl, template: t.reasonCompensatingControlTemplate },
    { value: "test_environment", label: t.reasonTestEnvironment, template: t.reasonTestEnvironmentTemplate },
    { value: "other", label: t.reasonOther, template: "" },
  ];

  const [findings, setFindings] = useState<Finding[]>([]);
  const [missingRequirements, setMissingRequirements] = useState<Array<{ code: string; title: string }>>([]);
  const [anci, setAnci] = useState<AnciStatus | null>(null);
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "ignored">("active");
  const [detailFinding, setDetailFinding] = useState<Finding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [report, setReport] = useState<AuditReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [pendingChange, setPendingChange] = useState<PendingStatusChange | null>(null);
  const [justification, setJustification] = useState("");
  const [reasonPreset, setReasonPreset] = useState("other");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function loadFindings() {
    setLoading(true);
    setError(null);

    Promise.all([
      api.get<{ data: Finding[] }>(`/api/v1/audits/${id}/findings`),
      api.get<{ data: EvidenceListResponse }>(`/api/v1/audits/${id}/evidences`),
      api.get<{ data: AnciStatus }>(`/api/v1/audits/${id}/anci-status`),
    ])
      .then(([findingsRes, evidencesRes, anciRes]) => {
        setFindings(findingsRes.data.data);
        setMissingRequirements(evidencesRes.data.data.missing_requirements);
        setAnci(anciRes.data.data);
      })
      .catch((err) => setError(getApiErrorMessage(err, t.loadFailed)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadFindings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const filteredFindings = useMemo(() => {
    const byStatus = findings.filter((f) =>
      statusFilter === "ignored" ? IGNORED_STATUSES.includes(f.status) : !IGNORED_STATUSES.includes(f.status)
    );
    return severityFilter === "all" ? byStatus : byStatus.filter((f) => f.severity === severityFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findings, severityFilter, statusFilter]);

  async function handleGenerateReport() {
    setGenerating(true);
    setReportError(null);
    try {
      const res = await api.get<{ data: AuditReport }>(`/api/v1/audits/${id}/report`);
      setReport(res.data.data);
      window.open(res.data.data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setReportError(getApiErrorMessage(err, t.generateFailed));
    } finally {
      setGenerating(false);
    }
  }

  function openStatusDialog(findingId: string, status: FindingStatus) {
    setPendingChange({ findingId, status });
    setJustification("");
    setReasonPreset("other");
    setSubmitError(null);
  }

  function handleReasonPresetChange(value: string) {
    setReasonPreset(value);
    const preset = REASON_PRESETS.find((r) => r.value === value);
    if (preset?.template) setJustification(preset.template);
  }

  async function confirmStatusChange() {
    if (!pendingChange) return;
    if (justification.trim().length < 10) {
      setSubmitError(t.justificationTooShort);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await api.patch<{ data: Finding }>(`/api/v1/findings/${pendingChange.findingId}/status`, {
        status: pendingChange.status,
        justification_notes: justification.trim(),
      });
      setFindings((prev) => prev.map((f) => (f.id === res.data.data.id ? { ...f, ...res.data.data } : f)));
      setPendingChange(null);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err, t.statusUpdateFailed));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/audits/${id}`}>
              <ArrowLeft className="size-4" aria-hidden />
              {dict.history.backToAudit}
            </Link>
          </Button>
          <h1 className="text-xl font-semibold">{t.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          {report && (
            <span className="text-sm text-muted-foreground">
              {t.score}: <span className="font-medium text-foreground">{report.riskScore.score}/100</span> (
              {report.riskScore.complianceLevel})
            </span>
          )}
          <Button onClick={handleGenerateReport} disabled={generating}>
            {generating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {generating ? t.generating : t.downloadPdf}
          </Button>
        </div>
      </div>

      {reportError && (
        <Alert variant="destructive">
          <AlertDescription>{reportError}</AlertDescription>
        </Alert>
      )}

      {anci && anci.technicalControls.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{dict.anci.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{dict.anci.seLabel}</span>
                  <span className="font-medium tabular-nums">{anci.sePercentage}%</span>
                </div>
                <Progress value={anci.sePercentage} className="h-1.5" />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span>{dict.anci.oivLabel}</span>
                  <span className="font-medium tabular-nums">{anci.oivPercentage}%</span>
                </div>
                <Progress value={anci.oivPercentage} className="h-1.5" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{dict.anci.oivHint}</p>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{dict.anci.technicalControls}</h3>
              <ul className="flex flex-col divide-y">
                {anci.technicalControls.map((control) => (
                  <li key={control.code} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium">{control.title}</span>
                      <span className="font-mono text-xs text-muted-foreground">{control.code}</span>
                    </div>
                    <Badge
                      variant={
                        control.status === "ok" ? "default" : control.status === "fail" ? "destructive" : "secondary"
                      }
                    >
                      {control.status === "ok"
                        ? dict.anci.statusOk
                        : control.status === "fail"
                          ? dict.anci.statusFail
                          : dict.anci.statusNotScanned}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.missingRequirements}</CardTitle>
        </CardHeader>
        <CardContent>
          {missingRequirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noMissingRequirements}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {missingRequirements.map((req) => (
                <li key={req.code} className="text-muted-foreground">
                  <span className="font-mono text-xs">[{req.code}]</span> {req.title}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.findings}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "ignored")}>
              <TabsList>
                {STATUS_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs value={severityFilter} onValueChange={(v) => setSeverityFilter(v as FindingSeverity | "all")}>
              <TabsList>
                {SEVERITY_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {filteredFindings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {statusFilter === "ignored" ? t.noIgnoredFindings : t.noFindingsForFilter}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colSeverity}</TableHead>
                  <TableHead>{t.colFinding}</TableHead>
                  <TableHead>{t.colRemediation}</TableHead>
                  <TableHead>{t.colStatus}</TableHead>
                  {canReview && <TableHead className="text-right">{t.colActions}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredFindings.map((finding) => (
                  <TableRow key={finding.id}>
                    <TableCell>
                      <SeverityBadge severity={finding.severity} />
                    </TableCell>
                    <TableCell className="font-medium">{finding.title}</TableCell>
                    <TableCell className="text-muted-foreground">{finding.remediation ?? "—"}</TableCell>
                    <TableCell>
                      <FindingStatusBadge status={finding.status} />
                    </TableCell>
                    {canReview ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setDetailFinding(finding)}>
                            <Eye className="size-3.5" aria-hidden />
                            {t.viewDetails}
                          </Button>
                          {statusFilter === "ignored" ? (
                            <Button variant="outline" size="sm" onClick={() => openStatusDialog(finding.id, "open")}>
                              <RotateCcw className="size-3.5" aria-hidden />
                              {t.reactivateAlert}
                            </Button>
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="size-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {finding.status !== "false_positive" && (
                                  <DropdownMenuItem onClick={() => openStatusDialog(finding.id, "false_positive")}>
                                    <ShieldOff className="size-3.5" aria-hidden />
                                    {t.markFalsePositive}
                                  </DropdownMenuItem>
                                )}
                                {finding.status !== "accepted_risk" && (
                                  <DropdownMenuItem onClick={() => openStatusDialog(finding.id, "accepted_risk")}>
                                    <CheckCircle2 className="size-3.5" aria-hidden />
                                    {t.acceptRisk}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={pendingChange !== null} onOpenChange={(open) => !open && setPendingChange(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.justificationTitle}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t.justificationDesc}</p>
          <div className="flex flex-col gap-3">
            {(pendingChange?.status === "false_positive" || pendingChange?.status === "accepted_risk") && (
              <>
                <Alert variant="destructive">
                  <AlertDescription>{t.consequenceWarning}</AlertDescription>
                </Alert>
                <div className="flex flex-col gap-2">
                  <label htmlFor="reason-preset" className="text-sm font-medium">
                    {t.reasonLabel}
                  </label>
                  <Select value={reasonPreset} onValueChange={handleReasonPresetChange}>
                    <SelectTrigger id="reason-preset" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REASON_PRESETS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div className="flex flex-col gap-2">
              <label htmlFor="justification" className="text-sm font-medium">
                {t.justificationLabel}
              </label>
              <Textarea
                id="justification"
                rows={4}
                placeholder={t.justificationPlaceholder}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </div>

            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingChange(null)} disabled={submitting}>
                {t.cancel}
              </Button>
              <Button onClick={confirmStatusChange} disabled={submitting}>
                {submitting ? t.confirming : t.confirm}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={detailFinding !== null} onOpenChange={(open) => !open && setDetailFinding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.detailsTitle}</DialogTitle>
          </DialogHeader>
          {detailFinding && (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <span className="font-medium">{detailFinding.title}</span>
                <span className="text-muted-foreground">{detailFinding.detail ?? t.detailsNoDetail}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">{t.detailsEngine}</dt>
                <dd className="font-medium">{detailFinding.source_engine}</dd>
                <dt className="text-muted-foreground">{t.detailsDetected}</dt>
                <dd className="font-medium">{new Date(detailFinding.detected_at).toLocaleString()}</dd>
                {detailFinding.cve_id && (
                  <>
                    <dt className="text-muted-foreground">{t.detailsCve}</dt>
                    <dd className="font-mono font-medium">{detailFinding.cve_id}</dd>
                  </>
                )}
              </dl>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setDetailFinding(null)}>
                  {t.detailsClose}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
