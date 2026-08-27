"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowLeft,
  DollarSign,
  Globe,
  Mail,
  Percent,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { api, getApiErrorMessage } from "@/lib/api";
import type { KpiPeriod, RealKpiReport } from "@/lib/types";
import { useProfile } from "@/hooks/useProfile";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const clpFormatter = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const pctFormatter = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
const dateFormatter = new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });

function formatClp(value: number): string {
  return clpFormatter.format(value);
}

const FUNNEL_COLORS = ["var(--cost-supabase-db)", "var(--cost-scan-engine)", "var(--cost-redis-workers)", "var(--cost-pdf-engine)"];

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof DollarSign;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 pt-6">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold whitespace-nowrap">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminKpisPage() {
  const { dict } = useI18n();
  const t = dict.admin.kpis;
  const { profile, loading: profileLoading } = useProfile();

  const [period, setPeriod] = useState<KpiPeriod>("current_month");
  const [data, setData] = useState<RealKpiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.isPlatformAdmin) return;
    setLoading(true);
    setError(null);
    api
      .get<{ data: RealKpiReport }>(`/api/v1/admin/kpis/real-metrics?period=${period}`)
      .then((res) => setData(res.data.data))
      .catch((err) => setError(getApiErrorMessage(err, t.loadFailed)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.isPlatformAdmin, period]);

  if (profileLoading) {
    return <Skeleton className="h-48" />;
  }

  if (!profile?.isPlatformAdmin) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t.accessDenied}</AlertDescription>
      </Alert>
    );
  }

  const funnelData = data
    ? [
        { name: t.funnelTotalOrgs, value: data.funnel.totalOrganizations },
        { name: t.opDomainsVerified, value: data.operational.verifiedDomainAssets },
        { name: t.funnelTrialActive, value: data.funnel.trialOrganizations },
        { name: t.funnelPayingOrgs, value: data.funnel.payingOrganizations },
      ]
    : [];

  const segmentLabel = (segment: string) => (segment === "trial_expired" ? t.segmentTrialExpired : t.segmentStandard);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={(v) => setPeriod(v as KpiPeriod)}>
            <SelectTrigger aria-label={t.periodLabel}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current_month">{t.periodCurrentMonth}</SelectItem>
              <SelectItem value="last_quarter">{t.periodLastQuarter}</SelectItem>
              <SelectItem value="year_to_date">{t.periodYearToDate}</SelectItem>
            </SelectContent>
          </Select>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin">
              <ArrowLeft className="size-3.5" aria-hidden />
              {t.backToAdmin}
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : (
        data && (
          <>
            <Alert>
              <AlertDescription>{t.billingNotConnectedNote}</AlertDescription>
            </Alert>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard icon={TrendingUp} label={t.kpiMrr} value={formatClp(data.financial.mrrRealClp)} />
              <StatCard icon={TrendingUp} label={t.kpiArr} value={formatClp(data.financial.arrRealClp)} />
              <StatCard
                icon={Percent}
                label={t.kpiGrossMargin}
                value={
                  data.financial.grossMarginPct !== null
                    ? `${pctFormatter.format(data.financial.grossMarginPct)}%`
                    : t.notAvailable
                }
              />
              <StatCard icon={DollarSign} label={t.kpiCogs} value={formatClp(data.financial.cogsRealClp)} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">{t.funnelTitle}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={funnelData} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={170}
                        tick={{ fontSize: 12 }}
                        stroke="var(--muted-foreground)"
                      />
                      <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {funnelData.map((_, i) => (
                          <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t.marketPenetrationTitle}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <p className="text-3xl font-semibold">
                    {pctFormatter.format(data.funnel.addressableMarket.penetrationPct)}%
                  </p>
                  <Progress value={Math.min(100, data.funnel.addressableMarket.penetrationPct)} />
                  <p className="text-xs text-muted-foreground">
                    {data.funnel.totalOrganizations} / {data.funnel.addressableMarket.totalCompanies.toLocaleString("es-CL")}{" "}
                    {t.marketPenetrationNote}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={Globe}
                label={t.opDomainsVerified}
                value={
                  data.operational.domainVerificationRatePct !== null
                    ? `${pctFormatter.format(data.operational.domainVerificationRatePct)}%`
                    : t.notAvailable
                }
                sub={`${data.operational.verifiedDomainAssets} / ${data.operational.totalDomainAssets}`}
              />
              <StatCard icon={TrendingUp} label={t.opAuditsCompleted} value={data.operational.auditsCompleted} />
              <StatCard icon={ShieldAlert} label={t.opCriticalFindings} value={data.operational.criticalFindingsDetected} />
              <StatCard icon={Mail} label={t.opItDelegation} value={data.operational.itDelegationEmailsSent} />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.activityChartTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data.dailyActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" minTickGap={24} />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" width={40} allowDecimals={false} />
                    <Tooltip
                      formatter={(value, key) => [value, key === "scansCompleted" ? t.seriesScans : t.seriesCriticalFindings]}
                      labelFormatter={(d) => `${t.dateLabel}: ${d}`}
                      contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }}
                    />
                    <Legend
                      formatter={(key: string) => (key === "scansCompleted" ? t.seriesScans : t.seriesCriticalFindings)}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="scansCompleted" stroke="var(--finops-revenue)" strokeWidth={2} dot={false} />
                    <Line
                      type="monotone"
                      dataKey="criticalFindings"
                      stroke="var(--finops-costs)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.subscriptionsTitle}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.subscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t.noSubscriptions}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.colOrg}</TableHead>
                        <TableHead>{t.colSegment}</TableHead>
                        <TableHead>{t.colCreated}</TableHead>
                        <TableHead>{t.colTrialExpires}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.subscriptions.map((row) => (
                        <TableRow key={row.organizationId}>
                          <TableCell>{row.organizationName}</TableCell>
                          <TableCell>
                            <Badge variant={row.segment === "standard" ? "outline" : "secondary"}>
                              {segmentLabel(row.segment)}
                            </Badge>
                          </TableCell>
                          <TableCell>{dateFormatter.format(new Date(row.createdAt))}</TableCell>
                          <TableCell>
                            {row.trialExpiresAt ? dateFormatter.format(new Date(row.trialExpiresAt)) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )
      )}
    </div>
  );
}
