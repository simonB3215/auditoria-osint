"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  DollarSign,
  FileClock,
  Gauge,
  LineChart,
  Search,
  ShieldCheck,
  ShieldQuestion,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProfile } from "@/hooks/useProfile";
import { useI18n } from "@/lib/i18n/context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";

const SIDEBAR_COLLAPSED_KEY = "aegis-admin-sidebar-collapsed";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

interface SearchOrg {
  id: string;
  name: string;
  primaryDomain: string | null;
}

interface SearchUser {
  id: string;
  fullName: string | null;
  email: string | null;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile, loading: profileLoading } = useProfile();
  const { dict } = useI18n();
  const t = dict.admin.layout;

  const [collapsed, setCollapsed] = useState(false);
  const [systemStatus, setSystemStatus] = useState<{ redisConnected: boolean; economicIndicatorsFresh: boolean } | null>(
    null
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [orgsIndex, setOrgsIndex] = useState<SearchOrg[]>([]);
  const [usersIndex, setUsersIndex] = useState<SearchUser[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isPlatformAdmin = profile?.isPlatformAdmin ?? false;

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => {
    if (!isPlatformAdmin) return;
    api
      .get<{ data: { redisConnected: boolean; economicIndicatorsFresh: boolean } }>("/api/v1/admin/system-status")
      .then((res) => setSystemStatus(res.data.data))
      .catch(() => setSystemStatus(null));
  }, [isPlatformAdmin]);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    Promise.all([
      api.get<{ data: SearchOrg[] }>("/api/v1/admin/organizations"),
      api.get<{ data: SearchUser[] }>("/api/v1/admin/users"),
    ])
      .then(([orgsRes, usersRes]) => {
        setOrgsIndex(orgsRes.data.data);
        setUsersIndex(usersRes.data.data);
      })
      .catch(() => {});
  }, [isPlatformAdmin]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return { orgs: [], users: [] };
    return {
      orgs: orgsIndex
        .filter((o) => o.name.toLowerCase().includes(q) || o.primaryDomain?.toLowerCase().includes(q))
        .slice(0, 5),
      users: usersIndex
        .filter((u) => u.fullName?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
        .slice(0, 5),
    };
  }, [searchQuery, orgsIndex, usersIndex]);

  const navGroups: NavGroup[] = [
    {
      label: t.groupGeneral,
      items: [
        { href: "/admin", label: t.navOverview, icon: Gauge },
        { href: "/admin/kpis", label: t.navKpis, icon: BarChart3 },
      ],
    },
    {
      label: t.groupManagement,
      items: [
        { href: "/admin/users", label: t.navUsers, icon: Users },
        { href: "/admin/organizations", label: t.navOrganizations, icon: Building2 },
      ],
    },
    {
      label: t.groupOperations,
      items: [
        { href: "/admin/domain-reviews", label: t.navDomainReviews, icon: ShieldQuestion },
        { href: "/admin/audit-logs", label: t.navAuditLogs, icon: FileClock },
      ],
    },
    {
      label: t.groupFinance,
      items: [
        { href: "/admin/costs", label: t.navCosts, icon: DollarSign },
        { href: "/admin/internal-finops", label: t.navInternalFinops, icon: LineChart },
      ],
    },
  ];

  if (profileLoading) {
    return (
      <div className="flex gap-6">
        <Skeleton className="h-[600px] w-56 shrink-0" />
        <Skeleton className="h-[600px] flex-1" />
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t.accessDenied}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex gap-6">
      <aside
        className={`sticky top-8 flex h-[calc(100vh-8rem)] shrink-0 flex-col rounded-lg border bg-card transition-[width] ${
          collapsed ? "w-14" : "w-60"
        }`}
      >
        <div className="flex items-center justify-between border-b px-3 py-3">
          {!collapsed && (
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              {t.brand}
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
          >
            {collapsed ? <ChevronsRight className="size-4" aria-hidden /> : <ChevronsLeft className="size-4" aria-hidden />}
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto p-2">
          {navGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t p-2">
          <Link
            href="/dashboard"
            title={collapsed ? t.backToApp : undefined}
            className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronsLeft className="size-4 shrink-0" aria-hidden />
            {!collapsed && <span className="truncate">{t.backToApp}</span>}
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-2.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
              placeholder={t.searchPlaceholder}
              className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-14 text-sm outline-none focus:ring-2 focus:ring-ring/50"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              ⌘K
            </kbd>

            {searchOpen && searchQuery.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover p-1 shadow-lg">
                {searchResults.orgs.length === 0 && searchResults.users.length === 0 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">{t.searchNoResults}</p>
                ) : (
                  <>
                    {searchResults.orgs.length > 0 && (
                      <div>
                        <p className="px-2 pt-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {t.navOrganizations}
                        </p>
                        {searchResults.orgs.map((o) => (
                          <Link
                            key={o.id}
                            href="/admin/organizations"
                            className="block rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
                          >
                            {o.name}
                            {o.primaryDomain && <span className="text-muted-foreground"> · {o.primaryDomain}</span>}
                          </Link>
                        ))}
                      </div>
                    )}
                    {searchResults.users.length > 0 && (
                      <div>
                        <p className="px-2 pt-1 text-[10px] font-semibold uppercase text-muted-foreground">{t.navUsers}</p>
                        {searchResults.users.map((u) => (
                          <Link key={u.id} href="/admin/users" className="block rounded-sm px-2 py-1.5 text-sm hover:bg-muted">
                            {u.fullName ?? u.email}
                            {u.email && <span className="text-muted-foreground"> · {u.email}</span>}
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {systemStatus && (
            <div className="flex items-center gap-2">
              <Badge variant={systemStatus.redisConnected ? "outline" : "destructive"} className="gap-1 text-[10px]">
                {systemStatus.redisConnected ? <Wifi className="size-3" aria-hidden /> : <WifiOff className="size-3" aria-hidden />}
                {t.statusWorkers}
              </Badge>
              <Badge variant={systemStatus.economicIndicatorsFresh ? "outline" : "destructive"} className="gap-1 text-[10px]">
                {systemStatus.economicIndicatorsFresh ? <Wifi className="size-3" aria-hidden /> : <WifiOff className="size-3" aria-hidden />}
                {t.statusApis}
              </Badge>
            </div>
          )}

          <ThemeToggle />
          <LanguageSwitcher />
        </div>

        {children}
      </div>
    </div>
  );
}
