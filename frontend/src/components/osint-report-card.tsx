"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EyeOff, Plus, RotateCcw } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { DiscoveredSubdomain, OsintBreachSummary, OsintReportData } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function OsintReportCard({ auditId, canReview }: { auditId: string; canReview: boolean }) {
  const { dict } = useI18n();
  const t = dict.osint;

  const [report, setReport] = useState<OsintReportData | null>(null);
  const [subdomains, setSubdomains] = useState<DiscoveredSubdomain[]>([]);
  const [breaches, setBreaches] = useState<OsintBreachSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api.get<{ data: { report: OsintReportData | null } }>(`/api/v1/audits/${auditId}/osint`),
      api.get<{ data: DiscoveredSubdomain[] }>(`/api/v1/audits/${auditId}/osint/subdomains`),
      canReview
        ? api.get<{ data: OsintBreachSummary }>(`/api/v1/audits/${auditId}/osint/breaches`)
        : Promise.resolve(null),
    ])
      .then(([statusRes, subdomainsRes, breachesRes]) => {
        setReport(statusRes.data.data.report);
        setSubdomains(subdomainsRes.data.data);
        setBreaches(breachesRes?.data.data ?? null);
      })
      .catch((err) => setError(getApiErrorMessage(err, t.loadFailed)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, canReview]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRegister(row: DiscoveredSubdomain) {
    setBusyId(row.id);
    setError(null);
    try {
      await api.post("/api/v1/assets", { type: "domain", value: row.hostname });
      setSubdomains((prev) => prev.map((item) => (item.id === row.id ? { ...item, registered: true } : item)));
    } catch (err) {
      setError(getApiErrorMessage(err, t.registerFailed));
    } finally {
      setBusyId(null);
    }
  }

  async function handleStatus(row: DiscoveredSubdomain, status: DiscoveredSubdomain["status"]) {
    setBusyId(row.id);
    setError(null);
    try {
      await api.patch(`/api/v1/osint/subdomains/${row.id}`, { status });
      setSubdomains((prev) => prev.map((item) => (item.id === row.id ? { ...item, status } : item)));
    } catch (err) {
      setError(getApiErrorMessage(err, t.dismissFailed));
    } finally {
      setBusyId(null);
    }
  }

  if (!report && !error) return null;

  const postures = Object.entries(report?.summaries ?? {}).filter(([, summary]) => summary.email_dns);
  const hibpUsed = Object.values(report?.sourceStatus ?? {}).some(
    (sources) => sources.breaches && sources.breaches.status !== "not_configured"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.reportTitle}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {postures.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t.emailPosture}</h3>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {postures.map(([domain, { email_dns: posture }]) => (
                <li key={domain}>
                  <span className="font-mono text-xs text-foreground">{domain}</span> — SPF: {posture!.spf ? t.found : t.notFound} · DMARC:{" "}
                  {posture!.dmarcPolicy ?? t.notFound} · DKIM: {posture!.dkimSelectors.join(", ") || t.notFound}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(report?.signals.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t.signals}</h3>
            <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
              {report!.signals.map((signal) => (
                <li key={signal.code}>
                  <span className="font-mono text-xs">{signal.code}</span> — {signal.text}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t.signalsHint}</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t.subdomains}</h3>
          {subdomains.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noSubdomains}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t.subdomainsHint}{" "}
                <Link href="/assets" className="font-medium text-primary underline-offset-4 hover:underline">
                  {t.goToAssets}
                </Link>
              </p>
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.colHost}</TableHead>
                      <TableHead>{t.colIps}</TableHead>
                      <TableHead>{t.colState}</TableHead>
                      {canReview && <TableHead className="text-right">{t.colActions}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subdomains.map((row) => (
                      <TableRow key={row.id} className={row.status === "dismissed" ? "opacity-60" : undefined}>
                        <TableCell className="whitespace-normal break-all font-mono text-xs">{row.hostname}</TableCell>
                        <TableCell className="text-xs">
                          {row.resolved_ips.length > 0 ? row.resolved_ips.length : "—"}
                          {row.behind_cdn && <span className="ml-1 text-muted-foreground">({t.cdn})</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.registered ? "default" : "secondary"}>
                            {row.registered ? t.registered : row.status === "dismissed" ? t.dismissed : t.outOfInventory}
                          </Badge>
                        </TableCell>
                        {canReview && (
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              {!row.registered && row.status === "new" && (
                                <>
                                  <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => handleRegister(row)}>
                                    <Plus className="size-3.5" aria-hidden />
                                    {t.register}
                                  </Button>
                                  <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => handleStatus(row, "dismissed")}>
                                    <EyeOff className="size-3.5" aria-hidden />
                                    {t.dismiss}
                                  </Button>
                                </>
                              )}
                              {!row.registered && row.status === "dismissed" && (
                                <Button size="sm" variant="ghost" disabled={busyId === row.id} onClick={() => handleStatus(row, "new")}>
                                  <RotateCcw className="size-3.5" aria-hidden />
                                  {t.restore}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>

        {canReview && breaches && breaches.accounts > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{t.breaches}</h3>
            <p className="text-sm text-muted-foreground">
              {t.breachesSummary.replace("{count}", String(breaches.accounts)).replace("{breaches}", breaches.breaches.join(", "))}
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
              {breaches.exposures.map((exposure, index) => (
                <li key={`${exposure.alias_masked}-${index}`}>
                  <span className="font-mono">{exposure.alias_masked}</span>
                  <span className="text-muted-foreground"> — {exposure.breaches.join(", ")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hibpUsed && (
          <p className="text-xs text-muted-foreground">
            {t.hibpAttribution}{" "}
            <a href="https://haveibeenpwned.com" target="_blank" rel="noreferrer" className="underline underline-offset-4">
              Have I Been Pwned
            </a>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
