"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { Asset, Framework } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewAuditPage() {
  const router = useRouter();
  const { dict } = useI18n();
  const t = dict.newAudit;

  const FRAMEWORKS: { value: Framework; label: string }[] = [
    { value: "iso27001", label: dict.dashboard.frameworks.iso27001 },
    { value: "nist_csf", label: dict.dashboard.frameworks.nist_csf },
    { value: "gdpr", label: dict.dashboard.frameworks.gdpr },
    { value: "local_dp_law", label: dict.dashboard.frameworks.local_dp_law },
    { value: "ley_21663_cl", label: dict.dashboard.frameworks.ley_21663_cl },
  ];

  const [title, setTitle] = useState("");
  const [framework, setFramework] = useState<Framework>("iso27001");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: Asset[] }>("/api/v1/assets")
      .then((res) => setAssets(res.data.data))
      .finally(() => setLoadingAssets(false));
  }, []);

  function toggleAsset(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ data: { id: string } }>("/api/v1/audits", {
        title,
        framework,
        asset_ids: [...selectedIds],
      });
      router.push(`/audits/${res.data.data.id}`);
    } catch (err) {
      setError(getApiErrorMessage(err, t.createFailed));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t.backToDashboard}
          </Link>
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">{t.auditTitle}</Label>
              <Input
                id="title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.titlePlaceholder}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="framework">{t.framework}</Label>
              <Select value={framework} onValueChange={(v) => setFramework(v as Framework)}>
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

            <div className="flex flex-col gap-2">
              <Label>{t.selectAssets}</Label>
              {loadingAssets ? (
                <Skeleton className="h-24" />
              ) : assets.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  {t.noAssetsAvailable}{" "}
                  <Link href="/assets" className="font-medium text-primary underline-offset-4 hover:underline">
                    {t.goToAssets}
                  </Link>
                </div>
              ) : (
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border p-2">
                  {assets.map((asset) => (
                    <label
                      key={asset.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={selectedIds.has(asset.id)}
                        onCheckedChange={() => toggleAsset(asset.id)}
                      />
                      <span className="font-mono text-xs">{asset.value}</span>
                      <span className="text-xs text-muted-foreground">({asset.type})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting} className="self-start">
              {submitting ? t.submitting : t.submit}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">{t.osintNote}</p>
        </CardContent>
      </Card>
    </div>
  );
}
