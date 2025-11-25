'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DateRangeSelector from '@/components/DateRangeSelector';
import {
  DateRange,
  getDateRangeFromPreset,
  toISOString,
  getUserTimezone,
  formatMinutesToDuration,
} from '@/lib/date-utils';
import {
  downloadCSV,
  downloadJSON,
  convertToCSV,
  generateExportFilename,
  formatReportMetadataHeader,
  prepareDataForCSV,
} from '@/lib/export-utils';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Clock, Users, Target, Activity, AlertTriangle, CheckCircle, BarChart3, Filter, Download, RefreshCw } from 'lucide-react';

type ReportType = 'department' | 'user' | 'sla' | 'trends' | 'comparative';

interface FilterState {
  departmentIds: string[];
  userIds: string[];
  groupIds: string[];
  statuses: string[];
}

const REPORT_TYPES = [
  { value: 'department', label: 'Department', icon: Users, description: 'Department metrics & workload' },
  { value: 'user', label: 'User', icon: Activity, description: 'User productivity & leaderboards' },
  { value: 'sla', label: 'SLA', icon: Target, description: 'Response times & compliance' },
  { value: 'trends', label: 'Trends', icon: TrendingUp, description: 'Patterns over time' },
  { value: 'comparative', label: 'Compare', icon: BarChart3, description: 'Period comparison' },
];

export default function ReportsPage() {
  const router = useRouter();

  const [reportType, setReportType] = useState<ReportType>('department');
  const [dateRange, setDateRange] = useState<DateRange>(getDateRangeFromPreset('last30Days'));
  const [timezone, setTimezone] = useState<string>(getUserTimezone());
  const [filters, setFilters] = useState<FilterState>({
    departmentIds: [],
    userIds: [],
    groupIds: [],
    statuses: [],
  });
  const [showFilters, setShowFilters] = useState(false);

  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [availableGroups, setAvailableGroups] = useState<any[]>([]);

  useEffect(() => {
    loadFilterOptions();
  }, []);

  useEffect(() => {
    fetchReport();
  }, [reportType, dateRange, timezone, filters]);

  const loadFilterOptions = async () => {
    try {
      const [depts, users, groups] = await Promise.all([
        fetch('/api/departments').then((r) => r.json()),
        fetch('/api/users').then((r) => r.json()),
        fetch('/api/groups').then((r) => r.json()),
      ]);
      setAvailableDepartments(depts.departments || []);
      setAvailableUsers(users.users || []);
      setAvailableGroups(groups.groups || []);
    } catch (error) {
      console.error('Failed to load filter options:', error);
    }
  };

  const fetchReport = async () => {
    setLoading(true);
    setError(null);

    try {
      const queryParams = new URLSearchParams({
        startDate: toISOString(dateRange.startDate),
        endDate: toISOString(dateRange.endDate),
        timezone,
        ...(filters.departmentIds.length > 0 && { departmentIds: filters.departmentIds.join(',') }),
        ...(filters.userIds.length > 0 && { userIds: filters.userIds.join(',') }),
        ...(filters.groupIds.length > 0 && { groupIds: filters.groupIds.join(',') }),
      });

      const response = await fetch(`/api/reports/${reportType}?${queryParams}`);
      if (!response.ok) throw new Error(`Failed to fetch ${reportType} report`);

      const data = await response.json();
      setReportData(data);
    } catch (error) {
      console.error('Report fetch error:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch report');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    if (!reportData) return;
    let csvData: any[] = [];

    switch (reportType) {
      case 'department': csvData = prepareDataForCSV(reportData.summary || []); break;
      case 'user': csvData = prepareDataForCSV(reportData.summary || []); break;
      case 'sla': csvData = prepareDataForCSV(reportData.violations || []); break;
      case 'trends': csvData = prepareDataForCSV(reportData.volumeTrends || []); break;
      case 'comparative': csvData = prepareDataForCSV(reportData.overallMetrics ? [reportData.overallMetrics] : []); break;
    }

    const metadataHeader = formatReportMetadataHeader({
      reportType,
      startDate: toISOString(dateRange.startDate),
      endDate: toISOString(dateRange.endDate),
      timezone,
      filters,
    });

    downloadCSV(metadataHeader + '\n' + convertToCSV(csvData), generateExportFilename(reportType, 'csv'));
  };

  const handleExportJSON = () => {
    if (!reportData) return;
    downloadJSON(reportData, generateExportFilename(reportType, 'json'));
  };

  const handleDateRangeChange = (range: DateRange, tz: string) => {
    setDateRange(range);
    setTimezone(tz);
  };

  const activeFiltersCount = filters.departmentIds.length + filters.userIds.length + filters.groupIds.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 bg-neutral-900"></div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
            KPI <span className="font-light text-neutral-500">Reports</span>
          </h1>
        </div>
        <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
          Comprehensive incident reporting and analytics
        </p>
      </div>

      {/* Report Type Selection */}
      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4">
          <div className="section-tag">Report Type</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {REPORT_TYPES.map((type) => {
            const Icon = type.icon;
            const isActive = reportType === type.value;
            return (
              <button
                key={type.value}
                onClick={() => setReportType(type.value as ReportType)}
                className={`p-3 text-left transition-all tech-border ${isActive ? '!bg-neutral-900 !text-white' : 'bg-white hover:bg-neutral-50'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4" strokeWidth={1} />
                  <span className="text-xs font-bold uppercase tracking-wider">{type.label}</span>
                </div>
                <p className={`text-[10px] ${isActive ? 'text-neutral-300' : 'text-neutral-500'}`}>{type.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filters Bar */}
      <div className="tech-border bg-white p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[280px]">
            <DateRangeSelector value={dateRange} timezone={timezone} onChange={handleDateRangeChange} showTimezone={true} />
          </div>

          <button onClick={() => setShowFilters(!showFilters)} className={`tech-button flex items-center gap-2 ${showFilters ? '!bg-neutral-900 !text-white' : ''}`}>
            <Filter className="h-3 w-3" strokeWidth={1} />
            Filters
            {activeFiltersCount > 0 && <span className="px-1.5 py-0.5 bg-white text-neutral-900 text-[10px] rounded-full font-bold">{activeFiltersCount}</span>}
          </button>

          <button onClick={fetchReport} disabled={loading} className="tech-button flex items-center gap-2">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} strokeWidth={1} />
            Refresh
          </button>

          <div className="flex gap-2">
            <button onClick={handleExportCSV} disabled={!reportData || loading} className="tech-button flex items-center gap-2 disabled:opacity-50">
              <Download className="h-3 w-3" strokeWidth={1} />CSV
            </button>
            <button onClick={handleExportJSON} disabled={!reportData || loading} className="tech-button flex items-center gap-2 disabled:opacity-50">
              <Download className="h-3 w-3" strokeWidth={1} />JSON
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="mt-4 pt-4 tech-border-t">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {reportType !== 'comparative' && availableDepartments.length > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Departments ({filters.departmentIds.length})</label>
                  <div className="max-h-32 overflow-y-auto tech-border p-2 space-y-1 bg-neutral-50">
                    {availableDepartments.map((dept) => (
                      <label key={dept.department_id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1">
                        <input type="checkbox" checked={filters.departmentIds.includes(String(dept.department_id))}
                          onChange={() => {
                            const id = String(dept.department_id);
                            setFilters({ ...filters, departmentIds: filters.departmentIds.includes(id) ? filters.departmentIds.filter(d => d !== id) : [...filters.departmentIds, id] });
                          }} className="w-4 h-4" />
                        <span className="text-xs text-neutral-900">{dept.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {reportType === 'user' && availableUsers.length > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Users ({filters.userIds.length})</label>
                  <div className="max-h-32 overflow-y-auto tech-border p-2 space-y-1 bg-neutral-50">
                    {availableUsers.map((user) => (
                      <label key={user.user_id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1">
                        <input type="checkbox" checked={filters.userIds.includes(String(user.user_id))}
                          onChange={() => {
                            const id = String(user.user_id);
                            setFilters({ ...filters, userIds: filters.userIds.includes(id) ? filters.userIds.filter(u => u !== id) : [...filters.userIds, id] });
                          }} className="w-4 h-4" />
                        <span className="text-xs text-neutral-900">{user.first_name || user.last_name ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : user.username || `User ${user.user_id}`}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {availableGroups.length > 0 && (
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">Groups ({filters.groupIds.length})</label>
                  <div className="max-h-32 overflow-y-auto tech-border p-2 space-y-1 bg-neutral-50">
                    {availableGroups.map((group) => (
                      <label key={group.group_id} className="flex items-center gap-2 cursor-pointer hover:bg-white p-1">
                        <input type="checkbox" checked={filters.groupIds.includes(String(group.group_id))}
                          onChange={() => {
                            const id = String(group.group_id);
                            setFilters({ ...filters, groupIds: filters.groupIds.includes(id) ? filters.groupIds.filter(g => g !== id) : [...filters.groupIds, id] });
                          }} className="w-4 h-4" />
                        <span className="text-xs text-neutral-900">{group.group_name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {activeFiltersCount > 0 && (
              <div className="mt-3 flex justify-end">
                <button onClick={() => setFilters({ departmentIds: [], userIds: [], groupIds: [], statuses: [] })} className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 hover:text-neutral-900">Clear All</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Report Content */}
      <div>
        {loading && (
          <div className="flex items-center justify-center h-64 tech-border bg-white">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
              <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Report...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="tech-border bg-white p-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-neutral-900" strokeWidth={1} />
              <span className="text-xs uppercase tracking-wider text-neutral-900 font-bold">Error Loading Report</span>
            </div>
            <p className="text-sm text-neutral-600">{error}</p>
          </div>
        )}

        {!loading && !error && reportData && (
          <>
            {reportType === 'department' && <DepartmentReport data={reportData} />}
            {reportType === 'user' && <UserReport data={reportData} />}
            {reportType === 'sla' && <SLAReport data={reportData} />}
            {reportType === 'trends' && <TrendsReport data={reportData} />}
            {reportType === 'comparative' && <ComparativeReport data={reportData} />}
          </>
        )}

        {!loading && !error && !reportData && (
          <div className="tech-border bg-white p-12 text-center">
            <BarChart3 className="h-12 w-12 text-neutral-300 mx-auto mb-4" strokeWidth={1} />
            <span className="text-xs uppercase tracking-wider text-neutral-500">Select report options to generate analytics</span>
          </div>
        )}
      </div>
    </div>
  );
}

// Metric Card Component
function MetricCard({ title, value, subtitle, icon: Icon, trend }: { title: string; value: string | number; subtitle: string; icon: any; trend?: 'up' | 'down' | 'neutral' }) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : null;
  return (
    <div className="tech-border bg-white p-4 min-h-[120px] flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">{title}</span>
        <Icon className="h-4 w-4 text-neutral-400" strokeWidth={1} />
      </div>
      <div className="mt-auto">
        <div className="flex items-end gap-2">
          <div className="text-2xl font-light tracking-tight text-neutral-900">{value}</div>
          {TrendIcon && <TrendIcon className={`h-4 w-4 mb-1 ${trend === 'up' ? 'text-neutral-900' : 'text-neutral-400'}`} strokeWidth={1.5} />}
        </div>
        <p className="text-[10px] text-neutral-400 uppercase tracking-wide mt-1">{subtitle}</p>
      </div>
    </div>
  );
}

// Department Report
function DepartmentReport({ data }: { data: any }) {
  const totals = data.summary?.reduce((acc: any, d: any) => ({ totalIncidents: acc.totalIncidents + (d.total_incidents || 0), resolvedIncidents: acc.resolvedIncidents + (d.resolved_incidents || 0), activeIncidents: acc.activeIncidents + (d.active_incidents || 0) }), { totalIncidents: 0, resolvedIncidents: 0, activeIncidents: 0 });
  const avgResolutionTime = data.summary?.reduce((a: number, d: any) => a + (d.avg_resolution_time_seconds || 0), 0) / (data.summary?.length || 1);

  const workloadData = data.summary?.map((d: any) => ({ name: d.department_name, incidents: d.total_incidents, resolved: d.resolved_incidents, active: d.active_incidents })) || [];
  const slaData = data.summary?.map((d: any) => ({ name: d.department_name, claimSLA: d.claim_sla_compliance_rate || 0, resolutionSLA: d.resolution_sla_compliance_rate || 0 })) || [];

  return (
    <div className="space-y-6">
      <div>
        <div className="section-header mb-4"><div className="section-tag">Overview</div><div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Total Incidents" value={totals?.totalIncidents || 0} subtitle="All Departments" icon={Activity} />
          <MetricCard title="Resolved" value={totals?.resolvedIncidents || 0} subtitle={`${((totals?.resolvedIncidents / totals?.totalIncidents) * 100 || 0).toFixed(1)}% rate`} icon={CheckCircle} trend={totals?.resolvedIncidents > totals?.activeIncidents ? 'up' : 'down'} />
          <MetricCard title="Active" value={totals?.activeIncidents || 0} subtitle="In Progress" icon={Clock} />
          <MetricCard title="Avg Resolution" value={formatMinutesToDuration(avgResolutionTime / 60)} subtitle="Mean Time" icon={Target} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">Workload</div></div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={workloadData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis type="number" stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <YAxis dataKey="name" type="category" width={100} stroke="#1a1a1a" style={{ fontSize: '10px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} />
              <Legend />
              <Bar dataKey="resolved" stackId="a" fill="#1a1a1a" name="Resolved" />
              <Bar dataKey="active" stackId="a" fill="#a3a3a3" name="Active" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">SLA Compliance</div></div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={slaData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="name" stroke="#1a1a1a" style={{ fontSize: '10px', fontFamily: 'monospace' }} angle={-45} textAnchor="end" height={70} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} domain={[0, 100]} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} formatter={(v: any) => `${v}%`} />
              <Legend />
              <Bar dataKey="claimSLA" fill="#1a1a1a" name="Claim SLA %" />
              <Bar dataKey="resolutionSLA" fill="#7a7a7a" name="Resolution SLA %" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4"><div className="section-tag">Department Details</div></div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-neutral-100 tech-border-b">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Department</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Total</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Resolved</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Active</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Avg Resolution</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Claim SLA</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Resolution SLA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.summary?.map((d: any, i: number) => (
                <tr key={i} className="hover:bg-neutral-50">
                  <td className="px-4 py-3 text-xs font-medium text-neutral-900">{d.department_name}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono text-neutral-900">{d.total_incidents}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono text-neutral-600">{d.resolved_incidents}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono text-neutral-600">{d.active_incidents}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono text-neutral-600">{formatMinutesToDuration(d.avg_resolution_time_seconds / 60)}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono">{d.claim_sla_compliance_rate || 0}%</td>
                  <td className="px-4 py-3 text-xs text-right font-mono">{d.resolution_sla_compliance_rate || 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.resolutionTimeDistribution?.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">Resolution Time Distribution</div></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.resolutionTimeDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="time_bucket" stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} />
              <Bar dataKey="incident_count" fill="#1a1a1a" name="Incidents" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// User Report
function UserReport({ data }: { data: any }) {
  const totalResolved = data.summary?.reduce((a: number, u: any) => a + (u.incidents_resolved_self || 0), 0) || 0;
  const avgProductivity = data.summary?.length > 0 ? (totalResolved / data.summary.length).toFixed(1) : 0;
  const top = data.summary?.[0];

  return (
    <div className="space-y-6">
      <div>
        <div className="section-header mb-4"><div className="section-tag">Team Performance</div><div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Active Users" value={data.summary?.length || 0} subtitle="With Activity" icon={Users} />
          <MetricCard title="Total Resolved" value={totalResolved} subtitle="By Team" icon={CheckCircle} />
          <MetricCard title="Avg Per User" value={avgProductivity} subtitle="Incidents" icon={Activity} />
          <MetricCard title="Top Performer" value={top?.incidents_resolved_self || 0} subtitle={top?.first_name || top?.username || 'N/A'} icon={Target} />
        </div>
      </div>

      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4"><div className="section-tag">Leaderboard</div></div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-neutral-100 tech-border-b">
              <tr>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Rank</th>
                <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500">User</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Resolved</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Active Time</th>
                <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Productivity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.summary?.map((u: any, i: number) => {
                const productivity = u.total_active_seconds > 0 ? ((u.incidents_resolved_self / (u.total_active_seconds / 3600)) * 100).toFixed(1) : 0;
                return (
                  <tr key={i} className="hover:bg-neutral-50">
                    <td className="px-4 py-3"><span className={`text-xs font-mono font-bold ${i < 3 ? 'text-neutral-900' : 'text-neutral-400'}`}>#{u.overall_rank || i + 1}</span></td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-neutral-900">{u.first_name || u.last_name ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : u.username || 'Unknown'}</div>
                      {u.username && <div className="text-[10px] text-neutral-500">@{u.username}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-right font-mono font-bold text-neutral-900">{u.incidents_resolved_self}</td>
                    <td className="px-4 py-3 text-xs text-right font-mono text-neutral-600">{formatMinutesToDuration(u.total_active_seconds / 60)}</td>
                    <td className="px-4 py-3 text-xs text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-neutral-200"><div className="h-full bg-neutral-900" style={{ width: `${Math.min(Number(productivity), 100)}%` }} /></div>
                        <span className="font-mono text-neutral-600">{productivity}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {data.summary?.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">Resolution Distribution</div></div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.summary.slice(0, 12).map((u: any) => ({ name: u.first_name || u.username || `User ${u.user_id}`, resolved: u.incidents_resolved_self }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="name" stroke="#1a1a1a" style={{ fontSize: '10px', fontFamily: 'monospace' }} angle={-45} textAnchor="end" height={70} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} />
              <Bar dataKey="resolved" fill="#1a1a1a" name="Resolved" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// SLA Report
function SLAReport({ data }: { data: any }) {
  const o = data.overallCompliance;
  const totalViolations = (o?.claim_sla_violations || 0) + (o?.resolution_sla_violations || 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="section-header mb-4"><div className="section-tag">SLA Overview</div><div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Claim SLA" value={`${o?.claim_sla_compliance_rate || 0}%`} subtitle="30 min target" icon={Clock} trend={o?.claim_sla_compliance_rate >= 80 ? 'up' : 'down'} />
          <MetricCard title="Resolution SLA" value={`${o?.resolution_sla_compliance_rate || 0}%`} subtitle="2 hour target" icon={Target} trend={o?.resolution_sla_compliance_rate >= 80 ? 'up' : 'down'} />
          <MetricCard title="Avg Time to First Response" value={formatMinutesToDuration(o?.avg_time_to_claim_minutes)} subtitle="Mean Response" icon={Activity} />
          <MetricCard title="SLA Violations" value={totalViolations} subtitle="Total Count" icon={AlertTriangle} trend={totalViolations === 0 ? 'up' : 'down'} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="tech-border bg-white p-6 text-center">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-4 font-semibold">Claim SLA</div>
          <div className="relative w-28 h-28 mx-auto">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="56" cy="56" r="48" stroke="#e5e5e5" strokeWidth="10" fill="none" />
              <circle cx="56" cy="56" r="48" stroke="#1a1a1a" strokeWidth="10" fill="none" strokeDasharray={`${(o?.claim_sla_compliance_rate || 0) * 3.02} 302`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-bold text-neutral-900">{o?.claim_sla_compliance_rate || 0}%</span></div>
          </div>
          <div className="mt-3 text-[10px] text-neutral-500">{o?.claim_sla_met || 0} of {o?.total_incidents_with_claim || 0} within target</div>
        </div>

        <div className="tech-border bg-white p-6 text-center">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-4 font-semibold">Resolution SLA</div>
          <div className="relative w-28 h-28 mx-auto">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="56" cy="56" r="48" stroke="#e5e5e5" strokeWidth="10" fill="none" />
              <circle cx="56" cy="56" r="48" stroke="#1a1a1a" strokeWidth="10" fill="none" strokeDasharray={`${(o?.resolution_sla_compliance_rate || 0) * 3.02} 302`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center"><span className="text-xl font-bold text-neutral-900">{o?.resolution_sla_compliance_rate || 0}%</span></div>
          </div>
          <div className="mt-3 text-[10px] text-neutral-500">{o?.resolution_sla_met || 0} of {o?.total_resolved_incidents || 0} within target</div>
        </div>
      </div>

      {data.trends?.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">SLA Trends</div></div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data.trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="date" stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <YAxis yAxisId="left" stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} domain={[0, 100]} />
              <YAxis yAxisId="right" orientation="right" stroke="#a3a3a3" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="claim_sla_compliance_rate" stroke="#1a1a1a" strokeWidth={2} name="Claim SLA %" />
              <Line yAxisId="left" type="monotone" dataKey="resolution_sla_compliance_rate" stroke="#7a7a7a" strokeWidth={2} name="Resolution SLA %" />
              <Bar yAxisId="right" dataKey="total_incidents" fill="#e5e5e5" name="Incidents" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Trends Report
function TrendsReport({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      {data.volumeTrends?.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">Incident Volume Over Time</div></div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={data.volumeTrends}>
              <defs>
                <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1a1a1a" stopOpacity={0.3}/><stop offset="95%" stopColor="#1a1a1a" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorResolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7a7a7a" stopOpacity={0.3}/><stop offset="95%" stopColor="#7a7a7a" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="time_period" stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} />
              <Legend />
              <Area type="monotone" dataKey="incidents_created" stroke="#1a1a1a" fillOpacity={1} fill="url(#colorCreated)" name="Created" strokeWidth={2} />
              <Area type="monotone" dataKey="incidents_resolved" stroke="#7a7a7a" fillOpacity={1} fill="url(#colorResolved)" name="Resolved" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.backlogAnalysis?.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">Backlog Analysis</div></div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data.backlogAnalysis}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="time_period" stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '11px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace', fontSize: '11px' }} />
              <Legend />
              <Line type="monotone" dataKey="active_backlog" stroke="#1a1a1a" name="Active Backlog" strokeWidth={3} dot={{ fill: '#1a1a1a' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Comparative Report
function ComparativeReport({ data }: { data: any }) {
  const metrics = data.overallMetrics;
  const getChange = (c: any) => {
    if (!c) return { icon: Minus, color: 'text-neutral-500', text: 'N/A' };
    return { icon: c.direction === 'up' ? TrendingUp : c.direction === 'down' ? TrendingDown : Minus, color: c.direction === 'up' ? 'text-neutral-900' : c.direction === 'down' ? 'text-neutral-400' : 'text-neutral-500', text: `${c.direction === 'up' ? '+' : ''}${c.percentage?.toFixed(1) || 0}%` };
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="tech-border bg-neutral-50 p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">Period 1 (Baseline)</div>
          <div className="text-sm font-mono text-neutral-900">{data.metadata?.period1?.startDate} to {data.metadata?.period1?.endDate}</div>
        </div>
        <div className="tech-border bg-white p-4">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">Period 2 (Current)</div>
          <div className="text-sm font-mono text-neutral-900">{data.metadata?.period2?.startDate} to {data.metadata?.period2?.endDate}</div>
        </div>
      </div>

      {metrics && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4"><div className="section-tag">Metrics Comparison</div></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(metrics).map(([k, v]: [string, any]) => {
              const ch = getChange(v.change);
              const Icon = ch.icon;
              return (
                <div key={k} className="tech-border bg-neutral-50 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3 font-semibold">{k.replace(/_/g, ' ')}</div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div><div className="text-[9px] text-neutral-400 mb-1">P1</div><div className="text-lg font-bold font-mono text-neutral-600">{typeof v.period1 === 'number' ? v.period1.toFixed(1) : v.period1}</div></div>
                    <div><div className="text-[9px] text-neutral-400 mb-1">P2</div><div className="text-lg font-bold font-mono text-neutral-900">{typeof v.period2 === 'number' ? v.period2.toFixed(1) : v.period2}</div></div>
                    <div><div className="text-[9px] text-neutral-400 mb-1">Δ</div><div className={`text-lg font-bold font-mono flex items-center justify-center gap-1 ${ch.color}`}><Icon className="h-4 w-4" strokeWidth={1.5} /><span>{ch.text}</span></div></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
