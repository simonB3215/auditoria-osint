export type UserRole = "ciso" | "auditor" | "viewer";

export interface Profile {
  id: string;
  organizationId: string;
  role: UserRole;
  isPlatformAdmin: boolean;
  /** Legado del rol auditor_guest (Piloto Invitado, removido) — solo no-null en perfiles que fueron guest en el pasado. */
  expiresAt: string | null;
  /** Límite de activos por organización (`MAX_ASSETS_PER_ORG` del backend) — nunca hardcodear este número en el frontend. */
  maxAssetsPerOrg: number;
}

export type AuditStatus = "draft" | "queued" | "running" | "completed" | "failed";
export type Framework = "iso27001" | "nist_csf" | "gdpr" | "local_dp_law" | "ley_21663_cl";

export interface Audit {
  id: string;
  title: string;
  framework: Framework;
  status: AuditStatus;
  risk_score: number | null;
  created_at: string;
  updated_at?: string;
}

export type AssetType = "ip" | "cidr" | "domain" | "repository" | "cloud_server";
export type AssetCriticality = "critica" | "alta" | "media" | "baja";
export type AssetVerificationStatus = "pending" | "verified";

export interface Asset {
  id: string;
  type: AssetType;
  value: string;
  criticality: AssetCriticality;
  tags: string[];
  verification_status: AssetVerificationStatus;
  /** Código a publicar en el TXT del dominio. Solo tiene sentido para type === "domain". */
  verification_token?: string;
  verified_at: string | null;
  created_at: string;
}

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "accepted_risk" | "remediated" | "false_positive";

export interface Finding {
  id: string;
  title: string;
  severity: FindingSeverity;
  status: FindingStatus;
  cve_id: string | null;
  detail: string | null;
  remediation: string | null;
  source_engine: string;
  detected_at: string;
  justification_notes: string | null;
  reviewed_by: string | null;
}

export type EvidenceValidationStatus = "pending" | "valid" | "invalid";

export interface Evidence {
  id: string;
  file_name: string;
  requirement_code: string | null;
  validation_status: EvidenceValidationStatus;
  validation_errors: string[] | null;
  created_at: string;
  /** null si quien la subió ya no tiene perfil (borrado) — ver migración 018. */
  uploader_name: string | null;
}

export interface CoverageResult {
  completion_percentage: number;
  missing_requirements: Array<{ code: string; title: string }>;
  covered_requirements: string[];
}

export type EvidenceFileKind = "pdf" | "json" | "xlsx";

export interface ComplianceRequirement {
  code: string;
  title: string;
  expectedFileKind: EvidenceFileKind;
  requiredFields?: string[];
  /** "technical" se satisface por escaneo, no espera evidencia subida — ver /audits/:id/anci-status. */
  kind?: "documentary" | "technical";
  /** Solo Ley 21.663: a qué nivel de obligación aplica (OIV hereda todo lo de SE). */
  tier?: "SE" | "OIV";
}

export type TechnicalControlStatus = "ok" | "fail" | "not_scanned";

export interface TechnicalControlResult {
  code: string;
  title: string;
  status: TechnicalControlStatus;
}

export interface AnciStatus {
  sePercentage: number;
  oivPercentage: number;
  technicalControls: TechnicalControlResult[];
}

export interface EvidenceListResponse {
  evidences: Evidence[];
  completion_percentage: number;
  missing_requirements: Array<{ code: string; title: string }>;
  covered_requirements: string[];
}

export interface EvidenceUploadResponse {
  evidence: Evidence;
  validation_errors: string[];
  completion_percentage: number;
  missing_requirements: Array<{ code: string; title: string }>;
  covered_requirements: string[];
}

export interface RiskScore {
  score: number;
  complianceLevel: "alto" | "medio" | "bajo" | "crítico";
  findingsPenalty: number;
  coveragePenalty: number;
}

export interface AuditReport {
  reportId: string;
  auditId: string;
  signedUrl: string;
  expiresInSeconds: number;
  riskScore: RiskScore;
  coverage: CoverageResult;
}

export interface DashboardSummary {
  totalAssets: number;
  networkAssetsCount: number;
  totalAudits: number;
  auditsByStatus: Record<AuditStatus, number>;
  findingsBySeverity: Record<FindingSeverity, number>;
  ignoredFindingsCount: number;
  averageCoveragePercentage: number | null;
  securityHealthScore: number | null;
  anciCompliance: { sePercentage: number; oivPercentage: number } | null;
  recentAudits: Audit[];
}

export type OrganizationPlan = "starter" | "pro" | "custom";

export interface AdminOrganization {
  id: string;
  name: string;
  plan: OrganizationPlan;
  is_suspended: boolean;
  created_at: string;
  auditCount: number;
  storageBytes: number;
  primaryDomain: string | null;
  domainStats: { total: number; verified: number };
}

export interface AdminUser {
  id: string;
  fullName: string | null;
  email: string | null;
  role: UserRole;
  isPlatformAdmin: boolean;
  organizationId: string;
  organizationName: string | null;
  createdAt: string;
  isDeactivated: boolean;
  lastSignInAt: string | null;
  hasTwoFactor: boolean;
}

export interface AdminUserStats {
  totalUsers: number;
  activeCount: number;
  inactiveCount: number;
  twoFactorPercentage: number;
  failedLoginAlertCount: number;
  platformAdminCount: number;
  staleAccountCount: number;
}

export interface AdminActivityEvent {
  type: "audit_created" | "asset_created" | "evidence_uploaded";
  label: string;
  createdAt: string;
}

export interface AdminOrgDomain {
  id: string;
  value: string;
  verification_status: AssetVerificationStatus;
  created_at: string;
}

export type CostCategoryKey =
  | "supabase_db"
  | "supabase_storage"
  | "redis_workers"
  | "scan_engine"
  | "pdf_engine"
  | "hosting";

export interface CostSummary {
  totalMonthlyCostClp: number;
  totalMonthlyCostCredits: number;
  averageCostPerAuditClp: number;
  averageCostPerAuditCredits: number;
  topSpendingOrg: { id: string; name: string; costClp: number; costCredits: number } | null;
  byService: { key: CostCategoryKey; costClp: number; costCredits: number; percentage: number }[];
  totals: { storageGb: number; scansExecuted: number; reportsGenerated: number; workerHours: number; mau: number };
}

export interface DailyCostPoint {
  date: string;
  supabase_db: number;
  supabase_storage: number;
  redis_workers: number;
  scan_engine: number;
  pdf_engine: number;
  hosting: number;
  total: number;
  totalCredits: number;
}

export interface OrgCostBreakdown {
  organizationId: string;
  organizationName: string;
  costClp: number;
  costCredits: number;
  auditCount: number;
}

export interface CostBreakdown {
  series: DailyCostPoint[];
  byOrg: OrgCostBreakdown[];
}

export interface AuditCostRow {
  auditId: string;
  auditTitle: string;
  organizationId: string;
  organizationName: string;
  storageMb: number;
  scansExecuted: number;
  reportsGenerated: number;
  dbCostClp: number;
  totalCostClp: number;
  totalCostCredits: number;
  breakdown: Record<CostCategoryKey, number>;
}

export interface PricingConfigRow {
  key: string;
  provider: string;
  service: string;
  unit: string;
  unit_price: number;
  description: string | null;
  updated_at: string;
}

export type AuditLogAction =
  | "EVIDENCE_UPLOADED"
  | "FINDING_STATUS_CHANGED"
  | "REPORT_GENERATED"
  | "USER_ROLE_CHANGED"
  | "ORGANIZATION_SUSPENDED"
  | "ORGANIZATION_REACTIVATED"
  | "ORGANIZATION_DELETED"
  | "RETENTION_POLICY_UPDATED"
  | "EVIDENCE_PURGED";

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  action: AuditLogAction;
  resource_type: string;
  resource_id: string | null;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface PlatformAuditLogEntry extends AuditLogEntry {
  organization_id: string | null;
  organization_name: string | null;
}

export interface RetentionSettings {
  organizationId: string;
  organizationName: string;
  retentionPeriodDays: number | null;
  totalEvidences: number;
  purgedEvidences: number;
  eligibleForPurge: number;
}

export interface EconomicIndicators {
  ufValue: number;
  utmValue: number;
  dolarValue: number;
  fetchedAt: string;
  /** true si Mindicador.cl no respondió en la última corrida y se está usando el último valor guardado. */
  stale: boolean;
}

export interface ProjectionInputs {
  startersCount: number;
  proCount: number;
  starterPriceUf: number;
  proPriceUf: number;
  costVarUsdPerClient: number;
  opexUsd: number;
  marketPenetrationPct: number;
}

export interface MonthlyProjectionPoint {
  month: number;
  revenueClp: number;
  costsClp: number;
  netProfitClp: number;
}

export interface ProjectionResult {
  totalClients: number;
  mrrClp: number;
  mrrUf: number;
  arrClp: number;
  cogsClp: number;
  opexClp: number;
  netProfitClp: number;
  netMarginPct: number;
  breakEvenClients: number | null;
  addressableClients: number;
  monthlyProjection: MonthlyProjectionPoint[];
}

export interface InternalFinopsProjection {
  indicators: EconomicIndicators;
  inputs: ProjectionInputs;
  addressableMarket: { totalCompanies: number; penetrationPct: number; potentialClients: number };
  projection: ProjectionResult;
}

export type KpiPeriod = "current_month" | "last_quarter" | "year_to_date";

export interface RealKpiFinancial {
  mrrRealClp: number;
  arrRealClp: number;
  arpuClp: number | null;
  cogsRealClp: number;
  grossMarginPct: number | null;
  payingOrganizations: number;
  billingConnected: boolean;
}

export interface RealKpiFunnel {
  totalOrganizations: number;
  trialOrganizations: number;
  payingOrganizations: number;
  trialToPaidConversionPct: number | null;
  churnRatePct: number | null;
  addressableMarket: { totalCompanies: number; penetrationPct: number };
}

export interface RealKpiOperational {
  totalDomainAssets: number;
  verifiedDomainAssets: number;
  domainVerificationRatePct: number | null;
  auditsCompleted: number;
  scanRunsCompleted: number;
  criticalFindingsDetected: number;
  itDelegationEmailsSent: number;
}

export interface DailyActivityPoint {
  date: string;
  scansCompleted: number;
  criticalFindings: number;
}

export type OrganizationSegment = "trial_expired" | "standard";

export interface SubscriptionSummaryRow {
  organizationId: string;
  organizationName: string;
  segment: OrganizationSegment;
  createdAt: string;
  trialExpiresAt: string | null;
}

export interface RealKpiReport {
  period: { key: KpiPeriod; from: string; to: string };
  financial: RealKpiFinancial;
  funnel: RealKpiFunnel;
  operational: RealKpiOperational;
  dailyActivity: DailyActivityPoint[];
  subscriptions: SubscriptionSummaryRow[];
}
