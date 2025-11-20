'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DateRangeSelector from '@/components/DateRangeSelector';
import ReportFilters, { ReportFiltersState } from '@/components/ReportFilters';
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
  PieChart,
  Pie,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';

type ReportType = 'department' | 'user' | 'sla' | 'trends' | 'comparative';

const CHART_COLORS = ['#1a1a1a', '#4a4a4a', '#7a7a7a', '#a3a3a3', '#d4d4d4', '#e5e5e5'];

export default function ReportsPage() {
  const router = useRouter();

  // Report configuration
  const [reportType, setReportType] = useState<ReportType>('department');
  const [dateRange, setDateRange] = useState<DateRange>(getDateRangeFromPreset('last30Days'));
  const [timezone, setTimezone] = useState<string>(getUserTimezone());
  const [filters, setFilters] = useState<ReportFiltersState>({
    departmentIds: [],
    userIds: [],
    groupIds: [],
    statuses: [],
  });

  // Data state
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Available options for filters
  const [availableDepartments, setAvailableDepartments] = useState<any[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [availableGroups, setAvailableGroups] = useState<any[]>([]);

  // Load filter options on mount
  useEffect(() => {
    loadFilterOptions();
  }, []);

  // Auto-fetch report when configuration changes
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

      if (!response.ok) {
        throw new Error(`Failed to fetch ${reportType} report`);
      }

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
    let reportName = reportType;

    // Extract appropriate data based on report type
    switch (reportType) {
      case 'department':
        csvData = prepareDataForCSV(reportData.summary || []);
        break;
      case 'user':
        csvData = prepareDataForCSV(reportData.summary || []);
        break;
      case 'sla':
        csvData = prepareDataForCSV(reportData.violations || []);
        break;
      case 'trends':
        csvData = prepareDataForCSV(reportData.volumeTrends || []);
        break;
      case 'comparative':
        csvData = prepareDataForCSV(reportData.overallMetrics ? [reportData.overallMetrics] : []);
        break;
    }

    const metadataHeader = formatReportMetadataHeader({
      reportType: reportName,
      startDate: toISOString(dateRange.startDate),
      endDate: toISOString(dateRange.endDate),
      timezone,
      filters,
    });

    const csv = metadataHeader + '\n' + convertToCSV(csvData);
    downloadCSV(csv, generateExportFilename(reportName, 'csv'));
  };

  const handleExportJSON = () => {
    if (!reportData) return;
    downloadJSON(reportData, generateExportFilename(reportType, 'json'));
  };

  const handleDateRangeChange = (range: DateRange, tz: string) => {
    setDateRange(range);
    setTimezone(tz);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-neutral-900"></div>
            <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
              KPI <span className="font-light text-neutral-500">Reports</span>
            </h1>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleExportCSV}
              disabled={!reportData || loading}
              className="tech-button px-4 py-2 text-sm font-mono uppercase tracking-wider disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={handleExportJSON}
              disabled={!reportData || loading}
              className="tech-button px-4 py-2 text-sm font-mono uppercase tracking-wider disabled:opacity-50"
            >
              Export JSON
            </button>
          </div>
        </div>
        <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
          Comprehensive incident reporting and analytics
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar - Configuration */}
        <div className="lg:col-span-1 space-y-4">
          {/* Report Type Selector */}
          <div className="tech-border bg-white p-4">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-3">
              Report Type
            </label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="w-full px-3 py-2 tech-border bg-white text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value="department">Department Performance</option>
              <option value="user">User Performance</option>
              <option value="sla">SLA Compliance</option>
              <option value="trends">Incident Trends</option>
              <option value="comparative">Comparative Analysis</option>
            </select>

            {/* Report Type Description */}
            <div className="mt-3 pt-3 tech-border-t">
              <p className="text-[10px] text-neutral-500 font-mono leading-relaxed">
                {reportType === 'department' && 'Analyze department performance metrics, resolution times, and workload distribution.'}
                {reportType === 'user' && 'Track individual user performance, productivity scores, and activity patterns.'}
                {reportType === 'sla' && 'Monitor SLA compliance rates, violations, and response time metrics.'}
                {reportType === 'trends' && 'Visualize incident volume trends, peak hours, and lifecycle patterns over time.'}
                {reportType === 'comparative' && 'Compare metrics between two time periods to identify improvements or regressions.'}
              </p>
            </div>
          </div>

          {/* Date Range Selector */}
          <div className="tech-border bg-white p-4">
            <DateRangeSelector
              value={dateRange}
              timezone={timezone}
              onChange={handleDateRangeChange}
              showTimezone={true}
            />
          </div>

          {/* Filters */}
          <ReportFilters
            value={filters}
            onChange={setFilters}
            availableDepartments={availableDepartments}
            availableUsers={availableUsers}
            availableGroups={availableGroups}
            showDepartments={reportType !== 'comparative'}
            showUsers={reportType === 'user'}
            showGroups={true}
            showStatuses={false}
          />
        </div>

        {/* Main Content Area - Report Display */}
        <div className="lg:col-span-3">
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
                <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Report Data...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="tech-border bg-white p-6">
              <span className="text-xs uppercase tracking-wider text-red-600">Error Loading Report</span>
              <p className="mt-2 text-sm text-neutral-600">{error}</p>
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
            <div className="tech-border bg-white p-6">
              <span className="text-xs uppercase tracking-wider text-neutral-500">Configure Report Settings</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Department Report Component
function DepartmentReport({ data }: { data: any }) {
  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div>
        <div className="section-header mb-4">
          <div className="section-tag">Department Overview</div>
          <div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.summary?.slice(0, 4).map((dept: any, idx: number) => (
            <div key={idx} className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                  {dept.department_name}
                </span>
              </div>
              <div className="mt-auto">
                <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                  {dept.total_incidents}
                </div>
                <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Total Incidents</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Department Performance Table */}
      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4">
          <div className="section-tag">Department Metrics</div>
        </div>

        <div className="space-y-2">
          {data.summary?.map((dept: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between py-2 tech-border-b last:border-0">
              <span className="text-xs uppercase tracking-wider text-neutral-600">{dept.department_name}</span>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-neutral-500 font-mono">{dept.resolved_incidents} resolved</span>
                <span className="text-[10px] text-neutral-500 font-mono">{formatMinutesToDuration(dept.avg_resolution_time_seconds / 60)}</span>
                <span className="text-xs font-bold text-neutral-900 font-mono">{dept.total_incidents}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Resolution Time Distribution Chart */}
      {data.resolutionTimeDistribution && data.resolutionTimeDistribution.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">Resolution Time Distribution</div>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.resolutionTimeDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="time_bucket" stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace' }} />
              <Bar dataKey="incident_count" fill="#1a1a1a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// User Report Component
function UserReport({ data }: { data: any }) {
  return (
    <div className="space-y-8">
      {/* Leaderboard */}
      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4">
          <div className="section-tag">User Leaderboard</div>
        </div>

        <div className="space-y-2">
          {data.summary?.map((user: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between py-2 tech-border-b last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-neutral-400 w-6">#{user.overall_rank}</span>
                <span className="text-xs uppercase tracking-wider text-neutral-900">
                  {user.first_name || user.last_name
                    ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                    : user.username || 'Unknown'}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-neutral-500 font-mono">{formatMinutesToDuration(user.total_active_seconds / 60)}</span>
                <span className="text-xs font-bold text-neutral-900 font-mono">
                  {user.incidents_resolved_self}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// SLA Report Component
function SLAReport({ data }: { data: any }) {
  const overallCompliance = data.overallCompliance;

  return (
    <div className="space-y-8">
      {/* SLA Compliance Summary */}
      <div>
        <div className="section-header mb-4">
          <div className="section-tag">SLA Overview</div>
          <div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Claim SLA</span>
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {overallCompliance?.claim_sla_compliance_rate || 0}%
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Compliance Rate</p>
            </div>
          </div>

          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Resolution SLA</span>
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {overallCompliance?.resolution_sla_compliance_rate || 0}%
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Compliance Rate</p>
            </div>
          </div>

          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Avg Time to Claim</span>
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {formatMinutesToDuration(overallCompliance?.avg_time_to_claim_minutes)}
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Mean Time</p>
            </div>
          </div>

          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">SLA Violations</span>
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {(overallCompliance?.claim_sla_violations || 0) +
                  (overallCompliance?.resolution_sla_violations || 0)}
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Total Count</p>
            </div>
          </div>
        </div>
      </div>

      {/* SLA Trends Chart */}
      {data.trends && data.trends.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">SLA Compliance Trends</div>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.trends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="date" stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace' }} />
              <Legend />
              <Line type="monotone" dataKey="claim_sla_compliance_rate" stroke="#1a1a1a" name="Claim SLA %" />
              <Line type="monotone" dataKey="resolution_sla_compliance_rate" stroke="#7a7a7a" name="Resolution SLA %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Trends Report Component
function TrendsReport({ data }: { data: any }) {
  return (
    <div className="space-y-8">
      {/* Volume Trends */}
      {data.volumeTrends && data.volumeTrends.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">Incident Volume Trends</div>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.volumeTrends}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="time_period" stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace' }} />
              <Legend />
              <Area type="monotone" dataKey="incidents_created" stackId="1" stroke="#1a1a1a" fill="#1a1a1a" name="Created" />
              <Area type="monotone" dataKey="incidents_resolved" stackId="2" stroke="#7a7a7a" fill="#7a7a7a" name="Resolved" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Backlog Analysis */}
      {data.backlogAnalysis && data.backlogAnalysis.length > 0 && (
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">Backlog Analysis</div>
          </div>

          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.backlogAnalysis}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="time_period" stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <YAxis stroke="#1a1a1a" style={{ fontSize: '12px', fontFamily: 'monospace' }} />
              <Tooltip contentStyle={{ backgroundColor: '#f4f4f4', border: '1px solid #1a1a1a', fontFamily: 'monospace' }} />
              <Legend />
              <Line type="monotone" dataKey="active_backlog" stroke="#1a1a1a" name="Active Backlog" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// Comparative Report Component
function ComparativeReport({ data }: { data: any }) {
  const metrics = data.overallMetrics;

  const getChangeIndicator = (change: any) => {
    if (!change) return null;
    const isImprovement =
      (change.direction === 'down' && change.value < 0) || // Lower time is better
      (change.direction === 'up' && change.value > 0);    // Higher count/rate is better

    return (
      <span className={`text-xs font-mono ${isImprovement ? 'text-green-700' : change.direction === 'flat' ? 'text-gray-500' : 'text-red-700'}`}>
        {change.direction === 'up' ? '↑' : change.direction === 'down' ? '↓' : '→'} {Math.abs(change.percentage).toFixed(1)}%
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* Period Information */}
      <div className="tech-border bg-white p-4">
        <div className="grid grid-cols-2 gap-4 text-sm font-mono">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Period 1</div>
            <div className="text-neutral-900">{data.metadata.period1.startDate} to {data.metadata.period1.endDate}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Period 2</div>
            <div className="text-neutral-900">{data.metadata.period2.startDate} to {data.metadata.period2.endDate}</div>
          </div>
        </div>
      </div>

      {/* Metrics Comparison */}
      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4">
          <div className="section-tag">Metrics Comparison</div>
        </div>

        <div className="space-y-2">
          {metrics && Object.entries(metrics).map(([key, value]: [string, any]) => (
            <div key={key} className="py-3 tech-border-b last:border-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-neutral-600">
                  {key.replace(/_/g, ' ')}
                </span>
                {getChangeIndicator(value.change)}
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm font-mono">
                <div>
                  <div className="text-[10px] text-neutral-500 mb-1">Period 1</div>
                  <div className="text-lg font-bold text-neutral-900">{typeof value.period1 === 'number' ? value.period1.toFixed(2) : value.period1}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 mb-1">Period 2</div>
                  <div className="text-lg font-bold text-neutral-900">{typeof value.period2 === 'number' ? value.period2.toFixed(2) : value.period2}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 mb-1">Change</div>
                  <div className="text-lg font-bold text-neutral-900">{typeof value.change.value === 'number' ? value.change.value.toFixed(2) : value.change.value}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
