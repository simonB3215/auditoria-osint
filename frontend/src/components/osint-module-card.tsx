"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Radar } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { Asset, OsintRun, OsintSourceOutcome } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MAX_DOMAINS_PER_RUN = 5;

/** Lo peor de cada fuente entre todos los dominios: es lo que hay que ver primero. */
const OUTCOME_RANK: OsintSourceOutcome[] = ["failed", "partial", "not_configured", "no_data", "ok"];

function worstOutcomes(run: OsintRun): Array<[string, OsintSourceOutcome]> {
  const worst = new Map<string, OsintSourceOutcome>();
  for (const sources of Object.values(run.source_status)) {
    for (const [source, { status }] of Object.entries(sources)) {
      const current = worst.get(source);
      if (!current || OUTCOME_RANK.indexOf(status) < OUTCOME_RANK.indexOf(current)) worst.set(source, status);
    }
  }
  return [...worst.entries()];
}

export function OsintModuleCard({ auditId, canWrite }: { auditId: string; canWrite: boolean }) {
  const { dict } = useI18n();
  const t = dict.osint;

  const [run, setRun] = useState<OsintRun | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [domains, setDomains] = useState<Asset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ownershipChecked, setOwnershipChecked] = useState(false);

  const load = useCallback(() => {
    api
      .get<{ data: { latest: OsintRun | null } }>(`/api/v1/audits/${auditId}/osint`)
      .then((res) => setRun(res.data.data.latest))
      .catch(() => undefined);
  }, [auditId]);

  useEffect(() => {
    load();
  }, [load]);

  const active = run?.status === "queued" || run?.status === "running";

  // Igual que el escaneo del Módulo A: se refresca solo mientras está en curso.
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [active, load]);

  async function openDialog() {
    setNotice(null);
    setOwnershipChecked(false);
    try {
      const res = await api.get<{ data: Asset[] }>("/api/v1/assets", { params: { type: "domain" } });
      const verified = res.data.data.filter((asset) => asset.verification_status === "verified");
      setDomains(verified);
      setSelected(new Set(verified.slice(0, MAX_DOMAINS_PER_RUN).map((asset) => asset.id)));
      setDialogOpen(true);
    } catch (err) {
      setNotice(getApiErrorMessage(err, t.startFailed));
    }
  }

  function toggleDomain(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleStart() {
    setDialogOpen(false);
    setStarting(true);
    setNotice(null);
    try {
      await api.post(`/api/v1/audits/${auditId}/osint/run`, { asset_ids: [...selected] });
      load();
    } catch (err) {
      setNotice(getApiErrorMessage(err, t.startFailed));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.eyebrow}</p>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <div className="flex items-start gap-2">
            <Radar className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{t.guaranteeTitle}</p>
              <p className="text-sm text-muted-foreground">{t.does}</p>
              <p className="text-sm text-muted-foreground">{t.doesNot}</p>
            </div>
          </div>

          {notice && (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}

          {run && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {t.lastRun}: <span className="font-medium">{t.runStatus[run.status]}</span>
              </p>
              {!active && (
                <div className="flex flex-wrap gap-1">
                  {worstOutcomes(run).map(([source, outcome]) => (
                    <Badge
                      key={source}
                      variant={outcome === "failed" ? "destructive" : outcome === "ok" ? "default" : "secondary"}
                    >
                      {t.sources[source as keyof typeof t.sources] ?? source}: {t.outcomes[outcome]}
                    </Badge>
                  ))}
                </div>
              )}
              {!active && run.status !== "failed" && (
                <Link href={`/audits/${auditId}/report`} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                  {t.viewResults}
                </Link>
              )}
            </div>
          )}

          {canWrite && (
            <Button type="button" variant="outline" size="sm" className="self-start" disabled={active || starting} onClick={openDialog}>
              {active || starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Radar className="size-4" aria-hidden />}
              {active ? t.running : t.run}
            </Button>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t.legend}</p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.confirmTitle}</DialogTitle>
            <DialogDescription>{t.confirmBody}</DialogDescription>
          </DialogHeader>

          {domains.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t.noDomains}{" "}
              <Link href="/assets" className="font-medium text-primary underline-offset-4 hover:underline">
                {t.goToAssets}
              </Link>
            </p>
          ) : (
            <>
              <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
                {domains.map((domain) => (
                  <label key={domain.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(domain.id)}
                      disabled={!selected.has(domain.id) && selected.size >= MAX_DOMAINS_PER_RUN}
                      onCheckedChange={(checked) => toggleDomain(domain.id, checked === true)}
                    />
                    <span className="font-mono text-xs">{domain.value}</span>
                  </label>
                ))}
              </div>
              {domains.length > MAX_DOMAINS_PER_RUN && (
                <p className="text-xs text-muted-foreground">{t.maxDomains.replace("{max}", String(MAX_DOMAINS_PER_RUN))}</p>
              )}
              <div className="flex items-start gap-2 rounded-md border p-3">
                <Checkbox
                  id="osint-ownership"
                  checked={ownershipChecked}
                  onCheckedChange={(checked) => setOwnershipChecked(checked === true)}
                />
                <Label htmlFor="osint-ownership" className="text-sm font-normal leading-snug">
                  {t.confirmCheckbox}
                </Label>
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button type="button" disabled={!ownershipChecked || selected.size === 0} onClick={handleStart}>
              <Radar className="size-4" aria-hidden />
              {t.run}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
