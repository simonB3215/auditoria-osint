"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, RotateCw, ShieldCheck } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";
import type { Asset, DomainDeclaration, DomainItemStatus } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { useProfile } from "@/hooks/useProfile";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_VARIANT: Record<DomainItemStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending_email: "outline",
  pending_review: "secondary",
  approved: "default",
  rejected: "destructive",
};

interface DeclaredItemResponse {
  domain: string;
  email_sent: boolean;
  status: DomainItemStatus;
}

export default function VerifyDomainsPage() {
  const { dict } = useI18n();
  const t = dict.domainVerification;
  const { profile, loading: profileLoading } = useProfile();
  const { toast } = useToast();

  const [domains, setDomains] = useState<Asset[]>([]);
  const [declarations, setDeclarations] = useState<DomainDeclaration[]>([]);
  const [mfaActive, setMfaActive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [organizationRut, setOrganizationRut] = useState("");
  const [signerRut, setSignerRut] = useState("");
  const [signedDocument, setSignedDocument] = useState<File | null>(null);
  const [powersDocument, setPowersDocument] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);

  const isCiso = profile?.role === "ciso";

  const load = useCallback(async () => {
    try {
      const [assetsRes, declarationsRes] = await Promise.all([
        api.get<{ data: Asset[] }>("/api/v1/assets", { params: { type: "domain" } }),
        api.get<{ data: DomainDeclaration[] }>("/api/v1/domain-declarations"),
      ]);
      const declared = declarationsRes.data.data;
      const open = new Set(
        declared.flatMap((declaration) =>
          declaration.domain_declaration_items
            .filter((item) => item.status === "pending_email" || item.status === "pending_review")
            .map((item) => item.assets.id)
        )
      );
      setLoadError(null);
      setDeclarations(declared);
      setDomains(assetsRes.data.data.filter((asset) => asset.verification_status !== "verified" && !open.has(asset.id)));
    } catch (err) {
      setLoadError(getApiErrorMessage(err, t.loadFailed));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isCiso) return;
    // La URL solo se puede leer en el navegador, no durante el render en servidor.
    const assetFromUrl = new URLSearchParams(window.location.search).get("asset");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (assetFromUrl) setSelected(new Set([assetFromUrl]));

    createClient()
      .auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => setMfaActive(data?.currentLevel === "aal2"));
    void load();
  }, [isCiso, load]);

  function toggleDomain(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!signedDocument || !powersDocument) return;
    const assetIds = domains.filter((domain) => selected.has(domain.id)).map((domain) => domain.id);
    if (assetIds.length === 0) return;

    setSubmitting(true);
    setFormError(null);

    const formData = new FormData();
    formData.append("organization_rut", organizationRut);
    formData.append("signer_rut", signerRut);
    formData.append("asset_ids", JSON.stringify(assetIds));
    formData.append("signed_document", signedDocument);
    formData.append("powers_document", powersDocument);

    try {
      await api.post<{ data: { items: DeclaredItemResponse[] } }>("/api/v1/domain-declarations", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast({ description: t.submitted, variant: "success" });
      setSelected(new Set());
      setSignedDocument(null);
      setPowersDocument(null);
      setFormKey((key) => key + 1);
      await load();
    } catch (err) {
      setFormError(getApiErrorMessage(err, t.submitFailed));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(itemId: string) {
    setResendingId(itemId);
    try {
      await api.post(`/api/v1/domain-declarations/items/${itemId}/resend-link`);
      toast({ description: t.resent, variant: "success" });
    } catch (err) {
      setLoadError(getApiErrorMessage(err, t.resendFailed));
    } finally {
      setResendingId(null);
    }
  }

  if (profileLoading || (isCiso && loading)) {
    return <Skeleton className="h-64" />;
  }

  const rows = declarations.flatMap((declaration) =>
    declaration.domain_declaration_items.map((item) => ({ declaration, item }))
  );
  const canSubmit =
    !submitting &&
    mfaActive === true &&
    domains.some((domain) => selected.has(domain.id)) &&
    signedDocument !== null &&
    powersDocument !== null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" asChild className="self-start">
          <Link href="/assets">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t.backToAssets}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <p className="text-sm text-muted-foreground">{t.subtitle}</p>
      </div>

      {!isCiso ? (
        <Alert>
          <AlertDescription>{t.onlyCiso}</AlertDescription>
        </Alert>
      ) : (
        <>
          {loadError && (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t.howTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>{t.howStep1}</li>
                <li>{t.howStep2}</li>
                <li>{t.howStep3}</li>
                <li>{t.howStep4}</li>
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-primary" aria-hidden />
                {t.formTitle}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {mfaActive === false && (
                <Alert className="mb-4">
                  <AlertDescription>
                    {t.mfaRequired}{" "}
                    <Link href="/settings/account" className="font-medium text-primary underline-offset-4 hover:underline">
                      {t.mfaLink}
                    </Link>
                  </AlertDescription>
                </Alert>
              )}

              <form key={formKey} onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t.domainsLabel}</Label>
                  {domains.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t.noDomains}</p>
                  ) : (
                    domains.map((domain) => (
                      <label key={domain.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={selected.has(domain.id)}
                          onCheckedChange={(checked) => toggleDomain(domain.id, checked === true)}
                        />
                        <span className="font-mono">{domain.value}</span>
                      </label>
                    ))
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="organization-rut">{t.organizationRut}</Label>
                    <Input
                      id="organization-rut"
                      required
                      placeholder={t.rutPlaceholder}
                      value={organizationRut}
                      onChange={(e) => setOrganizationRut(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="signer-rut">{t.signerRut}</Label>
                    <Input
                      id="signer-rut"
                      required
                      placeholder={t.rutPlaceholder}
                      value={signerRut}
                      onChange={(e) => setSignerRut(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="signed-document">{t.signedDocument}</Label>
                  <Input
                    id="signed-document"
                    type="file"
                    accept="application/pdf,.pdf"
                    required
                    onChange={(e) => setSignedDocument(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="powers-document">{t.powersDocument}</Label>
                  <Input
                    id="powers-document"
                    type="file"
                    accept="application/pdf,.pdf"
                    required
                    onChange={(e) => setPowersDocument(e.target.files?.[0] ?? null)}
                  />
                </div>

                {formError && (
                  <Alert variant="destructive">
                    <AlertDescription>{formError}</AlertDescription>
                  </Alert>
                )}

                <Button type="submit" disabled={!canSubmit} className="self-start">
                  {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {submitting ? t.submitting : t.submit}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card id="tramites">
            <CardHeader>
              <CardTitle className="text-base">{t.listTitle}</CardTitle>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.listEmpty}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t.colDomain}</TableHead>
                      <TableHead>{t.colSigner}</TableHead>
                      <TableHead>{t.colDate}</TableHead>
                      <TableHead>{t.colStatus}</TableHead>
                      <TableHead className="text-right">{t.colActions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ declaration, item }) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-mono text-xs">{item.assets.value}</TableCell>
                        <TableCell className="text-xs">{declaration.signer_rut}</TableCell>
                        <TableCell className="text-xs">{new Date(declaration.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <Badge variant={STATUS_VARIANT[item.status]}>{t.status[item.status]}</Badge>
                            {item.review_reason && (
                              <span className="text-xs text-muted-foreground">{t.reason[item.review_reason]}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {item.status === "pending_email" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resendingId === item.id}
                              onClick={() => handleResend(item.id)}
                            >
                              <RotateCw className="size-3.5" aria-hidden />
                              {t.resendLink}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
