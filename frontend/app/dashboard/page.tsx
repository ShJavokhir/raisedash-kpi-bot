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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!stats) {
    return <div>Error loading statistics</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard Overview</h1>
        <p className="mt-2 text-sm text-gray-600">
          Monitor your incident management performance and key metrics
        </p>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Incidents</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                {stats.overview.total_incidents}
              </p>
            </div>
            <div className="bg-indigo-100 rounded-full p-3">
              <AlertCircle className="h-6 w-6 text-indigo-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Incidents</p>
              <p className="mt-2 text-3xl font-bold text-orange-600">
                {stats.overview.active_incidents}
              </p>
            </div>
            <div className="bg-orange-100 rounded-full p-3">
              <Clock className="h-6 w-6 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Resolved</p>
              <p className="mt-2 text-3xl font-bold text-green-600">
                {stats.overview.resolved_incidents}
              </p>
            </div>
            <div className="bg-green-100 rounded-full p-3">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Avg Resolution</p>
              <p className="mt-2 text-3xl font-bold text-blue-600">
                {formatDuration(stats.overview.avg_resolution_time_seconds)}
              </p>
            </div>
            <div className="bg-blue-100 rounded-full p-3">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>
      </div>

      {/* SLA Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">SLA Performance</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Claim within 30 min</span>
                <span className="text-sm font-bold text-gray-900">{stats.sla.claim_rate}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{ width: `${stats.sla.claim_rate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600">Resolve within 2 hours</span>
                <span className="text-sm font-bold text-gray-900">{stats.sla.resolution_rate}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${stats.sla.resolution_rate}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Incidents by Status</h3>
          <div className="space-y-3">
            {stats.incidentsByStatus.map((item) => (
              <div key={item.status} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{item.status.replace('_', ' ')}</span>
                <span className="text-sm font-semibold text-gray-900">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Departments and Top Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Incidents by Department</h3>
          <div className="space-y-3">
            {stats.incidentsByDepartment.map((dept) => (
              <div key={dept.department_name || 'Unassigned'} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{dept.department_name || 'Unassigned'}</span>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-orange-600">{dept.active_count} active</span>
                  <span className="text-sm font-semibold text-gray-900">{dept.count} total</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Performers</h3>
          <div className="space-y-3">
            {stats.topPerformers.slice(0, 5).map((user, index) => (
              <div key={user.user_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-500">#{index + 1}</span>
                  <span className="text-sm text-gray-900">
                    {user.first_name || user.username || `User ${user.user_id}`}
                  </span>
                </div>
                <span className="text-sm font-semibold text-green-600">
                  {user.resolved_count} resolved
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
