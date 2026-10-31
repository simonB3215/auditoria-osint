"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Globe, HelpCircle, Loader2, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { Asset, AssetCriticality, AssetType } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { useProfile } from "@/hooks/useProfile";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const ASSET_TYPES: AssetType[] = ["ip", "cidr", "domain", "repository", "cloud_server"];
// Selector del modal de registro (a.md, "SIMPLIFICACIÓN DE TIPOS DE
// RECURSOS"): limitado a los dos tipos de perímetro externo que Nmap
// puede escanear sin pedir nada del usuario — cidr/repository/cloud_server
// generaban desconfianza (sugieren credenciales de nube o acceso a código
// fuente) y quedan fuera de la creación, aunque el tipo y el filtro de la
// tabla (`ASSET_TYPES` arriba) siguen soportando los 5 valores por si
// existiera algún activo de esos tipos cargado antes o vía API — no se
// tocó el schema del backend, solo este selector.
const REGISTRABLE_ASSET_TYPES: AssetType[] = ["ip", "domain"];
const CRITICALITIES: AssetCriticality[] = ["critica", "alta", "media", "baja"];
const TAG_CHIP_KEYS = ["production", "website", "internal", "testing", "backend", "frontend", "api", "database"] as const;

const CRITICALITY_DOT: Record<AssetCriticality, string> = {
  critica: "bg-[var(--severity-critical)]",
  alta: "bg-[var(--severity-high)]",
  media: "bg-[var(--severity-medium)]",
  baja: "bg-[var(--severity-low)]",
};

/**
 * Validación en tiempo real por tipo de recurso (a.md, "Mensajes de Error
 * Claros e Inmediatos"). No se agregó Zod/React Hook Form como pedía el
 * prompt original — es un solo formulario chico, un puñado de funciones
 * puras alcanza sin sumar una dependencia nueva al frontend (Zod hoy solo
 * lo usa el backend).
 */
function validateAssetValue(type: AssetType, value: string): "ip" | "cidr" | "domain" | "repository" | null {
  const v = value.trim();
  if (!v) return null;
  const octet = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  const ipRe = new RegExp(`^${octet}(\\.${octet}){3}$`);
  switch (type) {
    case "ip":
      return ipRe.test(v) ? null : "ip";
    case "cidr": {
      const [ip, prefix] = v.split("/");
      const validPrefix = prefix !== undefined && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
      return ip && ipRe.test(ip) && validPrefix ? null : "cidr";
    }
    case "domain":
      return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(v) ? null : "domain";
    case "repository":
      return /^https:\/\/[^\s]+\/[^\s]+$/i.test(v) ? null : "repository";
    case "cloud_server":
      return null;
  }
}

/**
 * Detección de rango privado (a.md, "Validación de IP Pública vs.
 * Privada"): es una advertencia, no un error — una IP privada es
 * sintácticamente válida, solo no es alcanzable desde Internet para el
 * escaneo externo. Se evalúa aparte de `validateAssetValue` porque
 * conviven: el campo puede estar "válido" (formato correcto) y a la vez
 * merecer esta advertencia.
 */
function isPrivateIpAddress(ip: string): boolean {
  const parts = ip.trim().split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  return false;
}

function isPrivateIpValue(type: AssetType, value: string): boolean {
  const v = value.trim();
  if (type === "ip") return isPrivateIpAddress(v);
  if (type === "cidr") return isPrivateIpAddress(v.split("/")[0] ?? "");
  return false;
}

/**
 * Label + ícono de ayuda "?" (a.md, "iconos de ayuda"): el texto también
 * queda siempre visible debajo del campo — el tooltip es un refuerzo, no
 * la única vía para acceder a la explicación. `id` (en vez de `htmlFor`)
 * es para el caso "leyenda de grupo" (ej. el RadioGroup de criticidad):
 * un <label for> apunta a UN control puntual, así que un grupo se asocia
 * en cambio vía `aria-labelledby` apuntando al `id` de este label.
 */
function FieldLabel({
  htmlFor,
  id,
  label,
  tooltip,
}: {
  htmlFor?: string;
  id?: string;
  label: string;
  tooltip: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor} id={id}>
        {label}
      </Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label={tooltip}
          >
            <HelpCircle className="size-3.5" aria-hidden />
          </button>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export default function AssetsPage() {
  const { dict } = useI18n();
  const t = dict.assets;
  // Límite de activos: viene de /users/me (env.MAX_ASSETS_PER_ORG en el
  // backend), nunca hardcodeado acá — ver a.md, auditoría post-venta,
  // Secundario A. Mientras el perfil no cargó, no se asume ningún valor.
  const { profile } = useProfile();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [criticalityFilter, setCriticalityFilter] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newType, setNewType] = useState<AssetType>("ip");
  const [newValue, setNewValue] = useState("");
  const [valueTouched, setValueTouched] = useState(false);
  const [newCriticality, setNewCriticality] = useState<AssetCriticality>("media");
  // TagInput consolidado (a.md, "Consolidación de Etiquetas"): un único
  // array de etiquetas finales en vez de separar "chips predefinidos
  // seleccionados" y "texto libre separado por coma" en dos mecanismos
  // distintos — las píldoras predefinidas son atajos que agregan/quitan
  // de esta misma lista, no un estado paralelo.
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const valueErrorKey = validateAssetValue(newType, newValue);
  const showPrivateIpWarning = !valueErrorKey && isPrivateIpValue(newType, newValue);

  function resetAssetForm() {
    setNewType("ip");
    setNewValue("");
    setValueTouched(false);
    setNewCriticality("media");
    setTags([]);
    setTagDraft("");
    setFormError(null);
  }

  function addTag(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setTags((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
  }

  function removeTag(label: string) {
    setTags((prev) => prev.filter((tag) => tag !== label));
  }

  function handleTagDraftKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagDraft);
      setTagDraft("");
    }
  }

  const [busyId, setBusyId] = useState<string | null>(null);

  const TYPE_LABEL: Record<AssetType, string> = {
    ip: t.typeIp,
    cidr: t.typeCidr,
    domain: t.typeDomain,
    repository: t.typeRepository,
    cloud_server: t.typeCloudServer,
  };
  const CRITICALITY_LABEL: Record<AssetCriticality, string> = {
    critica: t.criticalCritica,
    alta: t.criticalAlta,
    media: t.criticalMedia,
    baja: t.criticalBaja,
  };
  const CRITICALITY_IMPACT: Record<AssetCriticality, string> = {
    critica: t.criticalCriticaImpact,
    alta: t.criticalAltaImpact,
    media: t.criticalMediaImpact,
    baja: t.criticalBajaImpact,
  };
  const TYPE_DESCRIPTION: Record<AssetType, string> = {
    ip: t.typeDescIp,
    cidr: t.typeDescCidr,
    domain: t.typeDescDomain,
    repository: t.typeDescRepository,
    cloud_server: t.typeDescCloudServer,
  };
  const VALUE_PLACEHOLDER: Record<AssetType, string> = {
    ip: t.valuePlaceholderIp,
    cidr: t.valuePlaceholderCidr,
    domain: t.valuePlaceholderDomain,
    repository: t.valuePlaceholderRepository,
    cloud_server: t.valuePlaceholderCloudServer,
  };
  const VALUE_ERROR: Record<"ip" | "cidr" | "domain" | "repository", string> = {
    ip: t.valueErrorIp,
    cidr: t.valueErrorCidr,
    domain: t.valueErrorDomain,
    repository: t.valueErrorRepository,
  };
  const TAG_CHIP_LABEL: Record<(typeof TAG_CHIP_KEYS)[number], string> = {
    production: t.tagChipProduction,
    website: t.tagChipWebsite,
    internal: t.tagChipInternal,
    testing: t.tagChipTesting,
    backend: t.tagChipBackend,
    frontend: t.tagChipFrontend,
    api: t.tagChipApi,
    database: t.tagChipDatabase,
  };

  function loadAssets() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (typeFilter && typeFilter !== "all") params.set("type", typeFilter);
    if (criticalityFilter && criticalityFilter !== "all") params.set("criticality", criticalityFilter);

    api
      .get<{ data: Asset[] }>(`/api/v1/assets${params.toString() ? `?${params}` : ""}`)
      .then((res) => setAssets(res.data.data))
      .catch((err) => setError(getApiErrorMessage(err, t.loadFailed)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadAssets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, criticalityFilter]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setValueTouched(true);
    if (validateAssetValue(newType, newValue) || !newValue.trim()) return;

    setFormError(null);
    setSaving(true);
    try {
      await api.post("/api/v1/assets", { type: newType, value: newValue, criticality: newCriticality, tags });
      setDialogOpen(false);
      resetAssetForm();
      loadAssets();
    } catch (err) {
      setFormError(getApiErrorMessage(err, t.createFailed));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm(t.deleteConfirm)) return;
    setBusyId(id);
    try {
      await api.delete(`/api/v1/assets/${id}`);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(getApiErrorMessage(err, t.deleteFailed));
    } finally {
      setBusyId(null);
    }
  }

  async function handleVerify(id: string) {
    setBusyId(id);
    try {
      const res = await api.post<{ data: Asset }>(`/api/v1/assets/${id}/verify`);
      setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...res.data.data } : a)));
    } catch (err) {
      setError(getApiErrorMessage(err, t.verifyFailed));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold">{t.title}</h1>
          {/* Límite del MVP (a.md, "MVP: REGLAS DE NEGOCIO..."): el backend
              ya rechaza el POST al llegar al límite, esto solo lo deja
              visible de antemano. El número sale de /users/me
              (maxAssetsPerOrg), no hardcodeado — ver Secundario A. */}
          {profile && (
            <span className="text-sm text-muted-foreground">
              {t.assetLimitCounter
                .replace("{count}", String(assets.length))
                .replace("{max}", String(profile.maxAssetsPerOrg))}
            </span>
          )}
        </div>

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetAssetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" aria-hidden />
              {t.addAsset}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.modalTitle}</DialogTitle>
              <DialogDescription>{t.modalIntro}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="asset-type" label={t.type} tooltip={t.typeHelp} />
                <Select value={newType} onValueChange={(v) => setNewType(v as AssetType)}>
                  <SelectTrigger id="asset-type" className="w-full" aria-describedby="asset-type-desc">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REGISTRABLE_ASSET_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {TYPE_LABEL[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="asset-type-desc" className="text-xs text-muted-foreground">
                  {TYPE_DESCRIPTION[newType]}
                </p>
                <p className="text-xs text-muted-foreground">{t.typeSchemaRedirectNote}</p>
                {(newType === "ip" || newType === "cidr" || newType === "domain") && (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Globe className="size-3.5 shrink-0" aria-hidden />
                    {t.scanGuaranteeBadge}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel htmlFor="asset-value" label={t.value} tooltip={t.valueHelp} />
                <Input
                  id="asset-value"
                  required
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onBlur={() => setValueTouched(true)}
                  placeholder={VALUE_PLACEHOLDER[newType]}
                  aria-invalid={valueTouched && (!!valueErrorKey || !newValue.trim())}
                  aria-describedby={valueTouched && valueErrorKey ? "asset-value-error" : "asset-value-desc"}
                />
                {valueTouched && valueErrorKey ? (
                  <p id="asset-value-error" role="alert" className="text-xs font-medium text-destructive">
                    {VALUE_ERROR[valueErrorKey]}
                  </p>
                ) : valueTouched && !newValue.trim() ? (
                  <p id="asset-value-error" role="alert" className="text-xs font-medium text-destructive">
                    {t.valueErrorRequired}
                  </p>
                ) : (
                  <p id="asset-value-desc" className="text-xs text-muted-foreground">
                    {t.valueHelp}
                  </p>
                )}
                {showPrivateIpWarning && (
                  <p role="alert" className="rounded-md border border-[var(--severity-medium)]/40 bg-[var(--severity-medium)]/10 px-2.5 py-1.5 text-xs font-medium text-[var(--severity-medium)]">
                    {t.privateIpWarning}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel id="asset-criticality-label" label={t.criticality} tooltip={t.criticalityHelp} />
                <RadioGroup
                  value={newCriticality}
                  onValueChange={(v) => setNewCriticality(v as AssetCriticality)}
                  aria-labelledby="asset-criticality-label"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {CRITICALITIES.map((c) => (
                    <RadioGroupItem key={c} value={c} id={`asset-criticality-${c}`} className="flex flex-col gap-1 p-3">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <span className={cn("size-2.5 shrink-0 rounded-full", CRITICALITY_DOT[c])} aria-hidden />
                        {CRITICALITY_LABEL[c]}
                      </span>
                      <span className="text-xs text-muted-foreground">{CRITICALITY_IMPACT[c]}</span>
                    </RadioGroupItem>
                  ))}
                </RadioGroup>
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel label={t.tags} tooltip={t.tagsHelp} />
                <div
                  className="flex flex-wrap items-center gap-1.5 rounded-md border border-input px-2 py-1.5 focus-within:ring-3 focus-within:ring-ring/50"
                  role="group"
                  aria-label={t.tags}
                >
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        aria-label={t.tagsRemoveAria.replace("{tag}", tag)}
                        className="rounded-full hover:opacity-75 focus-visible:outline-none"
                      >
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                  <input
                    id="asset-tag-draft"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={handleTagDraftKeyDown}
                    placeholder={tags.length === 0 ? t.tagsAddPlaceholder : ""}
                    className="min-w-[12ch] flex-1 bg-transparent p-1 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {TAG_CHIP_KEYS.filter((key) => !tags.includes(TAG_CHIP_LABEL[key])).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => addTag(TAG_CHIP_LABEL[key])}
                      className="rounded-full border border-dashed border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      + {TAG_CHIP_LABEL[key]}
                    </button>
                  ))}
                </div>
              </div>

              {formError && (
                <Alert variant="destructive">
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    resetAssetForm();
                  }}
                >
                  {t.cancel}
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {saving ? t.saving : t.save}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3">
          <CardTitle className="text-base">{t.title}</CardTitle>
          <div className="ml-auto flex flex-wrap gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger size="sm" aria-label={t.filterType}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filterAll}</SelectItem>
                {ASSET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {TYPE_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={criticalityFilter} onValueChange={setCriticalityFilter}>
              <SelectTrigger size="sm" aria-label={t.filterCriticality}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.filterAll}</SelectItem>
                {CRITICALITIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CRITICALITY_LABEL[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t.noAssets}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.colType}</TableHead>
                  <TableHead>{t.colValue}</TableHead>
                  <TableHead>{t.colCriticality}</TableHead>
                  <TableHead>{t.colTags}</TableHead>
                  <TableHead>{t.colStatus}</TableHead>
                  <TableHead className="text-right">{t.colActions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((asset) => (
                  <TableRow key={asset.id}>
                    <TableCell>{TYPE_LABEL[asset.type]}</TableCell>
                    <TableCell className="font-mono text-xs">{asset.value}</TableCell>
                    <TableCell>{CRITICALITY_LABEL[asset.criticality]}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {asset.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={asset.verification_status === "verified" ? "default" : "secondary"}>
                        {asset.verification_status === "verified" ? t.verified : t.pending}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {asset.verification_status !== "verified" && asset.type === "domain" && (
                          <Button size="sm" variant="outline" asChild>
                            <Link href={`/assets/verify?asset=${asset.id}`}>
                              <ShieldCheck className="size-3.5" aria-hidden />
                              {t.verify}
                            </Link>
                          </Button>
                        )}
                        {asset.verification_status !== "verified" && asset.type !== "domain" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === asset.id}
                            onClick={() => handleVerify(asset.id)}
                          >
                            <ShieldCheck className="size-3.5" aria-hidden />
                            {t.verify}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === asset.id}
                          onClick={() => handleDelete(asset.id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
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

    </div>
  );
}
