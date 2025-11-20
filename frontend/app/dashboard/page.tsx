'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, TrendingUp } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';

interface Stats {
  overview: {
    total_incidents: number;
    active_incidents: number;
    resolved_incidents: number;
    recent_incidents: number;
    avg_resolution_time_seconds: number;
  };
  incidentsByStatus: Array<{ status: string; count: number }>;
  incidentsByDepartment: Array<{
    department_name: string;
    count: number;
    active_count: number;
  }>;
  topPerformers: Array<{
    user_id: number;
    username: string;
    first_name: string;
    last_name: string;
    resolved_count: number;
  }>;
  incidentsOverTime: Array<{ date: string; count: number }>;
  sla: {
    claim_rate: number;
    resolution_rate: number;
  };
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/stats');
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
          <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Metrics...</span>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="tech-border bg-white p-6">
        <span className="text-xs uppercase tracking-wider text-neutral-500">Error Loading Statistics</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 bg-neutral-900"></div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
            System <span className="font-light text-neutral-500">Overview</span>
          </h1>
        </div>
        <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
          Real-time incident management metrics and performance indicators
        </p>
      </div>

      {/* Key metrics */}
      <div>
        <div className="section-header mb-4">
          <div className="section-tag">Global Metrics</div>
          <div className="h-[1px] bg-neutral-300 flex-grow ml-4"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Total Incidents</span>
              <AlertCircle className="h-4 w-4 text-neutral-400" strokeWidth={1} />
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {stats.overview.total_incidents}
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">All Time</p>
            </div>
          </div>

          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Active Incidents</span>
              <Clock className="h-4 w-4 text-neutral-400" strokeWidth={1} />
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {stats.overview.active_incidents}
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">In Progress</p>
            </div>
          </div>

          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Resolved</span>
              <CheckCircle className="h-4 w-4 text-neutral-400" strokeWidth={1} />
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {stats.overview.resolved_incidents}
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Completed</p>
            </div>
          </div>

          <div className="tech-border bg-white/50 p-4 tech-card min-h-[120px] flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Avg Resolution</span>
              <TrendingUp className="h-4 w-4 text-neutral-400" strokeWidth={1} />
            </div>
            <div className="mt-auto">
              <div className="text-3xl font-light tracking-tighter text-neutral-900 mb-1">
                {formatDuration(stats.overview.avg_resolution_time_seconds)}
              </div>
              <p className="text-[10px] text-neutral-400 uppercase tracking-wide">Mean Time</p>
            </div>
          </div>
        </div>
      </div>

      {/* SLA Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">SLA Performance</div>
          </div>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-neutral-600 font-medium">Claim Within 30 Min</span>
                <span className="text-xs font-bold text-neutral-900 font-mono">{stats.sla.claim_rate}%</span>
              </div>
              <div className="status-bar">
                <div className="status-bar-fill" style={{ width: `${stats.sla.claim_rate}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-neutral-600 font-medium">Resolve Within 2 Hours</span>
                <span className="text-xs font-bold text-neutral-900 font-mono">{stats.sla.resolution_rate}%</span>
              </div>
              <div className="status-bar">
                <div className="status-bar-fill" style={{ width: `${stats.sla.resolution_rate}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">Incidents by Status</div>
          </div>
          <div className="space-y-2">
            {stats.incidentsByStatus.map((item) => (
              <div key={item.status} className="flex items-center justify-between py-2 tech-border-b last:border-0">
                <span className="text-xs uppercase tracking-wider text-neutral-600">{item.status.replace('_', ' ')}</span>
                <span className="text-xs font-bold text-neutral-900 font-mono">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Departments and Top Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">Department Distribution</div>
          </div>
          <div className="space-y-2">
            {stats.incidentsByDepartment.map((dept) => (
              <div key={dept.department_name || 'Unassigned'} className="flex items-center justify-between py-2 tech-border-b last:border-0">
                <span className="text-xs uppercase tracking-wider text-neutral-600">{dept.department_name || 'Unassigned'}</span>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-neutral-500 font-mono">{dept.active_count} active</span>
                  <span className="text-xs font-bold text-neutral-900 font-mono">{dept.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="tech-border bg-white p-4">
          <div className="section-header mb-4">
            <div className="section-tag">Top Performers</div>
          </div>
          <div className="space-y-2">
            {stats.topPerformers.slice(0, 5).map((user, index) => (
              <div key={user.user_id} className="flex items-center justify-between py-2 tech-border-b last:border-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-neutral-400 w-6">#{index + 1}</span>
                  <span className="text-xs uppercase tracking-wider text-neutral-900">
                    {user.first_name || user.username || `User ${user.user_id}`}
                  </span>
                </div>
                <span className="text-xs font-bold text-neutral-900 font-mono">
                  {user.resolved_count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
