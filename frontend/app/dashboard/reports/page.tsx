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
    <div className="min-h-screen bg-paper p-6 space-y-6">
      {/* Header */}
      <div className="tech-border bg-paper p-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="section-header mb-2">
              <span className="section-tag">KPI REPORTS</span>
              <div className="flex-1 h-px bg-border ml-4"></div>
            </div>
            <p className="text-sm text-subtle font-mono mt-2">
              Comprehensive incident reporting and analytics
            </p>
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar - Configuration */}
        <div className="lg:col-span-1 space-y-4">
          {/* Report Type Selector */}
          <div className="tech-border bg-paper p-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-ink mb-3">
              Report Type
            </label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as ReportType)}
              className="w-full px-3 py-2 tech-border bg-paper text-ink font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ink"
            >
              <option value="department">Department Performance</option>
              <option value="user">User Performance</option>
              <option value="sla">SLA Compliance</option>
              <option value="trends">Incident Trends</option>
              <option value="comparative">Comparative Analysis</option>
            </select>

            {/* Report Type Description */}
            <div className="mt-3 pt-3 tech-border-t">
              <p className="text-xs text-subtle font-mono leading-relaxed">
                {reportType === 'department' && 'Analyze department performance metrics, resolution times, and workload distribution.'}
                {reportType === 'user' && 'Track individual user performance, productivity scores, and activity patterns.'}
                {reportType === 'sla' && 'Monitor SLA compliance rates, violations, and response time metrics.'}
                {reportType === 'trends' && 'Visualize incident volume trends, peak hours, and lifecycle patterns over time.'}
                {reportType === 'comparative' && 'Compare metrics between two time periods to identify improvements or regressions.'}
              </p>
            </div>
          </div>

          {/* Date Range Selector */}
          <div className="tech-border bg-paper p-4">
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
            <div className="tech-border bg-paper p-12 text-center">
              <div className="inline-block w-8 h-8 border-2 border-ink border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-4 text-sm font-mono text-subtle">Loading report data...</p>
            </div>
          )}

          {error && (
            <div className="tech-border bg-paper p-6 border-2 border-red-500">
              <div className="section-tag bg-red-500 text-white">ERROR</div>
              <p className="mt-3 text-sm font-mono text-ink">{error}</p>
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
            <div className="tech-border bg-paper p-12 text-center">
              <p className="text-sm font-mono text-subtle">
                Configure your report settings and click Generate Report
              </p>
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
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {data.summary?.slice(0, 4).map((dept: any, idx: number) => (
          <div key={idx} className="tech-card p-4">
            <div className="text-xs uppercase tracking-wider text-subtle mb-2">
              {dept.department_name}
            </div>
            <div className="text-2xl font-bold font-mono text-ink">
              {dept.total_incidents}
            </div>
            <div className="text-xs text-subtle mt-1">Total Incidents</div>
          </div>
        ))}
      </div>

      {/* Department Performance Table */}
      <div className="tech-border bg-paper p-6">
        <div className="section-header mb-4">
          <span className="section-tag">DEPARTMENT METRICS</span>
          <div className="flex-1 h-px bg-border ml-4"></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="tech-border-b">
                <th className="text-left py-2 px-3 font-bold uppercase tracking-wider">Department</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">Total</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">Resolved</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">Avg Time</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">SLA %</th>
              </tr>
            </thead>
            <tbody>
              {data.summary?.map((dept: any, idx: number) => (
                <tr key={idx} className="tech-border-b hover:bg-subtle">
                  <td className="py-2 px-3">{dept.department_name}</td>
                  <td className="text-right py-2 px-3">{dept.total_incidents}</td>
                  <td className="text-right py-2 px-3">{dept.resolved_incidents}</td>
                  <td className="text-right py-2 px-3">
                    {formatMinutesToDuration(dept.avg_resolution_time_seconds / 60)}
                  </td>
                  <td className="text-right py-2 px-3">{dept.resolution_sla_compliance_rate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resolution Time Distribution Chart */}
      {data.resolutionTimeDistribution && data.resolutionTimeDistribution.length > 0 && (
        <div className="tech-border bg-paper p-6">
          <div className="section-header mb-4">
            <span className="section-tag">RESOLUTION TIME DISTRIBUTION</span>
            <div className="flex-1 h-px bg-border ml-4"></div>
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
    <div className="space-y-6">
      {/* Leaderboard */}
      <div className="tech-border bg-paper p-6">
        <div className="section-header mb-4">
          <span className="section-tag">USER LEADERBOARD</span>
          <div className="flex-1 h-px bg-border ml-4"></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full font-mono text-sm">
            <thead>
              <tr className="tech-border-b">
                <th className="text-left py-2 px-3 font-bold uppercase tracking-wider">Rank</th>
                <th className="text-left py-2 px-3 font-bold uppercase tracking-wider">User</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">Resolved</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">Active Time</th>
                <th className="text-right py-2 px-3 font-bold uppercase tracking-wider">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.summary?.map((user: any, idx: number) => (
                <tr key={idx} className="tech-border-b hover:bg-subtle">
                  <td className="py-2 px-3">#{user.overall_rank}</td>
                  <td className="py-2 px-3">
                    {user.first_name || user.last_name
                      ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                      : user.username || 'Unknown'}
                  </td>
                  <td className="text-right py-2 px-3">{user.incidents_resolved_self}</td>
                  <td className="text-right py-2 px-3">
                    {formatMinutesToDuration(user.total_active_seconds / 60)}
                  </td>
                  <td className="text-right py-2 px-3 font-bold">{user.productivity_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// SLA Report Component
function SLAReport({ data }: { data: any }) {
  const overallCompliance = data.overallCompliance;

  return (
    <div className="space-y-6">
      {/* SLA Compliance Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="tech-card p-4">
          <div className="text-xs uppercase tracking-wider text-subtle mb-2">Claim SLA</div>
          <div className="text-3xl font-bold font-mono text-ink">
            {overallCompliance?.claim_sla_compliance_rate || 0}%
          </div>
          <div className="text-xs text-subtle mt-1">Compliance Rate</div>
        </div>

        <div className="tech-card p-4">
          <div className="text-xs uppercase tracking-wider text-subtle mb-2">Resolution SLA</div>
          <div className="text-3xl font-bold font-mono text-ink">
            {overallCompliance?.resolution_sla_compliance_rate || 0}%
          </div>
          <div className="text-xs text-subtle mt-1">Compliance Rate</div>
        </div>

        <div className="tech-card p-4">
          <div className="text-xs uppercase tracking-wider text-subtle mb-2">Avg Time to Claim</div>
          <div className="text-2xl font-bold font-mono text-ink">
            {formatMinutesToDuration(overallCompliance?.avg_time_to_claim_minutes)}
          </div>
        </div>

        <div className="tech-card p-4">
          <div className="text-xs uppercase tracking-wider text-subtle mb-2">SLA Violations</div>
          <div className="text-2xl font-bold font-mono text-ink">
            {(overallCompliance?.claim_sla_violations || 0) +
              (overallCompliance?.resolution_sla_violations || 0)}
          </div>
        </div>
      </div>

      {/* SLA Trends Chart */}
      {data.trends && data.trends.length > 0 && (
        <div className="tech-border bg-paper p-6">
          <div className="section-header mb-4">
            <span className="section-tag">SLA COMPLIANCE TRENDS</span>
            <div className="flex-1 h-px bg-border ml-4"></div>
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
    <div className="space-y-6">
      {/* Volume Trends */}
      {data.volumeTrends && data.volumeTrends.length > 0 && (
        <div className="tech-border bg-paper p-6">
          <div className="section-header mb-4">
            <span className="section-tag">INCIDENT VOLUME TRENDS</span>
            <div className="flex-1 h-px bg-border ml-4"></div>
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
        <div className="tech-border bg-paper p-6">
          <div className="section-header mb-4">
            <span className="section-tag">BACKLOG ANALYSIS</span>
            <div className="flex-1 h-px bg-border ml-4"></div>
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
    <div className="space-y-6">
      {/* Period Information */}
      <div className="tech-border bg-paper p-4">
        <div className="grid grid-cols-2 gap-4 text-sm font-mono">
          <div>
            <div className="text-xs uppercase tracking-wider text-subtle mb-1">Period 1</div>
            <div className="text-ink">{data.metadata.period1.startDate} to {data.metadata.period1.endDate}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-subtle mb-1">Period 2</div>
            <div className="text-ink">{data.metadata.period2.startDate} to {data.metadata.period2.endDate}</div>
          </div>
        </div>
      </div>

      {/* Metrics Comparison */}
      <div className="tech-border bg-paper p-6">
        <div className="section-header mb-4">
          <span className="section-tag">METRICS COMPARISON</span>
          <div className="flex-1 h-px bg-border ml-4"></div>
        </div>

        <div className="space-y-4">
          {metrics && Object.entries(metrics).map(([key, value]: [string, any]) => (
            <div key={key} className="tech-border p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold uppercase tracking-wider text-ink">
                  {key.replace(/_/g, ' ')}
                </div>
                {getChangeIndicator(value.change)}
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm font-mono">
                <div>
                  <div className="text-xs text-subtle mb-1">Period 1</div>
                  <div className="text-lg font-bold">{typeof value.period1 === 'number' ? value.period1.toFixed(2) : value.period1}</div>
                </div>
                <div>
                  <div className="text-xs text-subtle mb-1">Period 2</div>
                  <div className="text-lg font-bold">{typeof value.period2 === 'number' ? value.period2.toFixed(2) : value.period2}</div>
                </div>
                <div>
                  <div className="text-xs text-subtle mb-1">Change</div>
                  <div className="text-lg font-bold">{typeof value.change.value === 'number' ? value.change.value.toFixed(2) : value.change.value}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
