"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, FileText, Loader2, X } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { DomainReview } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { useProfile } from "@/hooks/useProfile";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Decision {
  kind: "approve" | "reject";
  review: DomainReview;
}

export default function DomainReviewsPage() {
  const { dict } = useI18n();
  const t = dict.domainVerification;
  const { toast } = useToast();
  const { profile, loading: profileLoading } = useProfile();
  const isPlatformAdmin = profile?.isPlatformAdmin ?? false;

  const [reviews, setReviews] = useState<DomainReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notes, setNotes] = useState("");
  const [powersInvalid, setPowersInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ data: DomainReview[] }>("/api/v1/admin/domain-reviews");
      setReviews(res.data.data);
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err, t.reviewsLoadFailed));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isPlatformAdmin) void load();
  }, [isPlatformAdmin, load]);

  async function openDocument(review: DomainReview, kind: "signed" | "powers") {
    setError(null);
    try {
      const res = await api.get<Blob>(`/api/v1/admin/domain-reviews/${review.id}/documents/${kind}`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${review.domain}-${kind}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t.documentFailed);
    }
  }

  function openDecision(kind: Decision["kind"], review: DomainReview) {
    setDecision({ kind, review });
    setNotes("");
    setPowersInvalid(false);
    setDecisionError(null);
  }

  async function submitDecision(e: FormEvent) {
    e.preventDefault();
    if (!decision) return;
    setSaving(true);
    setDecisionError(null);
    try {
      const path = `/api/v1/admin/domain-reviews/${decision.review.id}/${decision.kind}`;
      await api.post(
        path,
        decision.kind === "approve" ? { notes: notes.trim() || undefined } : { notes, powers_invalid: powersInvalid }
      );
      toast({ description: t.status[decision.kind === "approve" ? "approved" : "rejected"], variant: "success" });
      setDecision(null);
      await load();
    } catch (err) {
      setDecisionError(getApiErrorMessage(err, t.decisionFailed));
    } finally {
      setSaving(false);
    }
  }

  if (profileLoading || (isPlatformAdmin && loading)) {
    return <Skeleton className="h-64" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">{t.reviewsTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.reviewsSubtitle}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}{" "}
            <Link href="/settings/account" className="font-medium underline-offset-4 hover:underline">
              {t.mfaLink}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          {error && reviews.length === 0 ? null : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.reviewsEmpty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colDomain}</TableHead>
                  <TableHead>{t.colOrganization}</TableHead>
                  <TableHead>{t.colRuts}</TableHead>
                  <TableHead>{t.colEmail}</TableHead>
                  <TableHead className="text-right">{t.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => (
                  <TableRow key={review.id}>
                    <TableCell className="whitespace-normal break-all font-mono text-xs">{review.domain}</TableCell>
                    <TableCell className="whitespace-normal text-sm">{review.organization_name}</TableCell>
                    <TableCell className="text-xs">
                      {review.organization_rut}
                      <br />
                      {review.signer_rut}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={review.email_confirmed_at ? "secondary" : "outline"}>
                          {review.email_confirmed_at ? t.emailConfirmed : t.emailNotConfirmed}
                        </Badge>
                        {review.review_reason && (
                          <span className="text-xs text-muted-foreground">{t.reason[review.review_reason]}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="grid min-w-52 grid-cols-2 gap-2">
                        <Button size="sm" variant="ghost" onClick={() => openDocument(review, "signed")}>
                          <FileText className="size-3.5" aria-hidden />
                          {t.viewSigned}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openDocument(review, "powers")}>
                          <FileText className="size-3.5" aria-hidden />
                          {t.viewPowers}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openDecision("reject", review)}>
                          <X className="size-3.5" aria-hidden />
                          {t.reject}
                        </Button>
                        <Button size="sm" onClick={() => openDecision("approve", review)}>
                          <Check className="size-3.5" aria-hidden />
                          {t.approve}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={decision !== null} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent>
          {decision && (
            <form onSubmit={submitDecision} className="flex flex-col gap-4">
              <DialogHeader>
                <DialogTitle>
                  {(decision.kind === "approve" ? t.approveTitle : t.rejectTitle).replace("{domain}", decision.review.domain)}
                </DialogTitle>
                <DialogDescription>
                  {decision.kind === "approve"
                    ? t.approveDescription.replace("{organization}", decision.review.organization_name)
                    : t.rejectDescription}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-2">
                <Label htmlFor="review-notes">{decision.kind === "approve" ? t.notesLabel : t.notesRequired}</Label>
                <Textarea
                  id="review-notes"
                  required={decision.kind === "reject"}
                  minLength={decision.kind === "reject" ? 10 : undefined}
                  maxLength={1000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {decision.kind === "reject" && (
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    className="mt-0.5"
                    checked={powersInvalid}
                    onCheckedChange={(checked) => setPowersInvalid(checked === true)}
                  />
                  {t.powersInvalid}
                </label>
              )}

              {decisionError && (
                <Alert variant="destructive">
                  <AlertDescription>{decisionError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDecision(null)}>
                  {t.cancel}
                </Button>
                <Button type="submit" disabled={saving} variant={decision.kind === "approve" ? "default" : "destructive"}>
                  {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                  {decision.kind === "approve" ? t.approve : t.reject}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
