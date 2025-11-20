'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  Mail,
  MessageSquare,
  Building2,
  Users,
  Activity,
  CheckCircle,
  Clock,
  AlertCircle,
  Calendar,
  TrendingUp,
} from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface UserDetail {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  telegram_handle: string;
  team_role: string;
  language_code: string;
  is_bot: boolean;
  group_connections: number[];
  created_at: string;
  updated_at: string;
  departments: Department[];
  groups: Group[];
  stats: UserStats;
}

interface Department {
  department_id: number;
  name: string;
  company_id: number;
  added_at: string;
}

interface Group {
  group_id: number;
  group_name: string;
  company_id: number;
  status: string;
}

interface UserStats {
  incidents_created: number;
  incidents_created_resolved: number;
  incidents_created_active: number;
  incidents_claimed: number;
  incidents_claimed_resolved: number;
  incidents_claimed_active: number;
  incidents_resolved_by: number;
}

interface Incident {
  incident_id: string;
  status: string;
  description: string;
  created_by_id: number;
  created_by_handle: string;
  t_created: string;
  t_resolved: string | null;
  department_id: number | null;
}

export default function UserDetailPage() {
  const params = useParams();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchUserDetail();
    fetchUserIncidents();
  }, [params.id]);

  const fetchUserDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/users/${params.id}`);

      if (!response.ok) {
        if (response.status === 404) {
          setError('User not found');
        } else {
          setError('Failed to load user details');
        }
        return;
      }

      const data = await response.json();
      setUser(data);
    } catch (err) {
      console.error('Error fetching user:', err);
      setError('Failed to load user details');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserIncidents = async () => {
    try {
      setIncidentsLoading(true);
      // Fetch incidents created by this user
      const response = await fetch(`/api/incidents`);
      if (response.ok) {
        const data = await response.json();
        // Filter incidents for this user
        const userIncidents = data.incidents.filter(
          (inc: Incident) => inc.created_by_id === parseInt(params.id as string)
        );
        setIncidents(userIncidents);
      }
    } catch (err) {
      console.error('Error fetching incidents:', err);
    } finally {
      setIncidentsLoading(false);
    }
  };

  const getUserDisplayName = (user: UserDetail) => {
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return user.username || user.telegram_handle || `User ${user.user_id}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Resolved':
      case 'Closed':
        return 'bg-green-100 text-green-800';
      case 'In_Progress':
        return 'bg-blue-100 text-blue-800';
      case 'Awaiting_Department':
      case 'Awaiting_Claim':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredIncidents = statusFilter === 'all'
    ? incidents
    : incidents.filter(inc => inc.status === statusFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-neutral-900 mb-4"></div>
          <p className="text-neutral-600">Loading user details...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center text-red-600">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <p className="text-lg font-semibold">{error || 'User not found'}</p>
          <Link
            href="/dashboard/users"
            className="mt-4 inline-block text-blue-600 hover:underline"
          >
            Back to Users
          </Link>
        </div>
      </div>
    );
  }

  const resolutionRate = user.stats.incidents_created > 0
    ? Math.round((user.stats.incidents_created_resolved / user.stats.incidents_created) * 100)
    : 0;

  const claimResolutionRate = user.stats.incidents_claimed > 0
    ? Math.round((user.stats.incidents_claimed_resolved / user.stats.incidents_claimed) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/users"
          className="inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900 mb-4 hover:underline"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Users
        </Link>
        <div className="border-b-2 border-neutral-800 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0 h-16 w-16 tech-border bg-white flex items-center justify-center">
                <User className="h-8 w-8 text-neutral-500" strokeWidth={1} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-widest uppercase text-ink">
                  {getUserDisplayName(user)}
                </h1>
                <p className="text-sm text-neutral-600 mt-1">{user.telegram_handle}</p>
                {user.team_role && (
                  <span className="inline-block mt-2 badge">
                    {user.team_role}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* User Information Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Basic Info Card */}
        <div className="tech-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-4 w-4 text-neutral-500" strokeWidth={1} />
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-700">
              Basic Info
            </h3>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">User ID</span>
              <p className="font-mono text-neutral-900">{user.user_id}</p>
            </div>
            {user.username && (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Username</span>
                <p className="font-mono text-neutral-900">@{user.username}</p>
              </div>
            )}
            {user.language_code && (
              <div>
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Language</span>
                <p className="text-neutral-900">{user.language_code.toUpperCase()}</p>
              </div>
            )}
          </div>
        </div>

        {/* Activity Card */}
        <div className="tech-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-neutral-500" strokeWidth={1} />
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-700">
              Activity
            </h3>
          </div>
          <div className="space-y-2 text-sm">
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Joined</span>
              <p className="text-neutral-900">{formatDate(user.created_at)}</p>
            </div>
            <div>
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Last Updated</span>
              <p className="text-neutral-900">{formatDate(user.updated_at)}</p>
            </div>
          </div>
        </div>

        {/* Departments Card */}
        <div className="tech-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <Building2 className="h-4 w-4 text-neutral-500" strokeWidth={1} />
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-700">
              Departments
            </h3>
          </div>
          <div className="text-sm">
            {user.departments.length === 0 ? (
              <p className="text-neutral-500 text-xs">No departments</p>
            ) : (
              <ul className="space-y-1">
                {user.departments.map(dept => (
                  <li key={dept.department_id}>
                    <Link
                      href={`/dashboard/departments/${dept.department_id}`}
                      className="text-neutral-900 hover:text-blue-600 hover:underline"
                    >
                      {dept.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Groups Card */}
        <div className="tech-border bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-neutral-500" strokeWidth={1} />
            <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-700">
              Groups
            </h3>
          </div>
          <div className="text-sm">
            {user.groups.length === 0 ? (
              <p className="text-neutral-500 text-xs">No groups</p>
            ) : (
              <ul className="space-y-1">
                {user.groups.slice(0, 3).map(group => (
                  <li key={group.group_id} className="text-neutral-900 truncate">
                    {group.group_name}
                  </li>
                ))}
                {user.groups.length > 3 && (
                  <li className="text-neutral-500 text-xs">
                    +{user.groups.length - 3} more
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Performance Statistics */}
      <div className="tech-border bg-white p-6">
        <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-700 mb-4">
          Performance Statistics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Created Incidents */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-5 w-5 text-blue-600" />
              <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
                Incidents Created
              </h3>
            </div>
            <p className="text-3xl font-bold text-neutral-900 mb-1">
              {user.stats.incidents_created}
            </p>
            <div className="space-y-1 text-xs text-neutral-600">
              <div className="flex justify-between">
                <span>Resolved:</span>
                <span className="font-medium text-green-600">
                  {user.stats.incidents_created_resolved}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Active:</span>
                <span className="font-medium text-yellow-600">
                  {user.stats.incidents_created_active}
                </span>
              </div>
              {user.stats.incidents_created > 0 && (
                <div className="flex justify-between pt-1 border-t">
                  <span>Resolution Rate:</span>
                  <span className="font-medium">{resolutionRate}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Claimed Incidents */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
                Incidents Claimed
              </h3>
            </div>
            <p className="text-3xl font-bold text-neutral-900 mb-1">
              {user.stats.incidents_claimed}
            </p>
            <div className="space-y-1 text-xs text-neutral-600">
              <div className="flex justify-between">
                <span>Resolved:</span>
                <span className="font-medium text-green-600">
                  {user.stats.incidents_claimed_resolved}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Active:</span>
                <span className="font-medium text-yellow-600">
                  {user.stats.incidents_claimed_active}
                </span>
              </div>
              {user.stats.incidents_claimed > 0 && (
                <div className="flex justify-between pt-1 border-t">
                  <span>Resolution Rate:</span>
                  <span className="font-medium">{claimResolutionRate}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Resolved By */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5 text-purple-600" />
              <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
                Incidents Resolved
              </h3>
            </div>
            <p className="text-3xl font-bold text-neutral-900 mb-1">
              {user.stats.incidents_resolved_by}
            </p>
            <p className="text-xs text-neutral-600">
              Total incidents marked as resolved by this user
            </p>
          </div>

          {/* Total Involvement */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-5 w-5 text-indigo-600" />
              <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
                Total Involvement
              </h3>
            </div>
            <p className="text-3xl font-bold text-neutral-900 mb-1">
              {user.stats.incidents_created + user.stats.incidents_claimed}
            </p>
            <p className="text-xs text-neutral-600">
              Combined created and claimed incidents
            </p>
          </div>
        </div>
      </div>

      {/* Recent Incidents */}
      <div className="tech-border bg-white">
        <div className="p-4 border-b border-neutral-200">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-700">
              Incidents Created by User
            </h2>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1 text-xs border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900"
            >
              <option value="all">All Status</option>
              <option value="Awaiting_Department">Awaiting Department</option>
              <option value="Awaiting_Claim">Awaiting Claim</option>
              <option value="In_Progress">In Progress</option>
              <option value="Awaiting_Summary">Awaiting Summary</option>
              <option value="Resolved">Resolved</option>
              <option value="Closed">Closed</option>
            </select>
          </div>
        </div>
        {incidentsLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="text-xs uppercase tracking-wider text-neutral-500">Loading incidents...</div>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="text-center py-12">
            <AlertCircle className="h-12 w-12 text-neutral-300 mx-auto mb-3" strokeWidth={1} />
            <p className="text-xs uppercase tracking-wider text-neutral-500">
              {statusFilter === 'all' ? 'No incidents created' : 'No incidents with this status'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-neutral-100">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Incident ID
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredIncidents.slice(0, 10).map((incident) => (
                  <tr key={incident.incident_id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/dashboard/incidents/${incident.incident_id}`}
                        className="text-xs font-mono text-blue-600 hover:underline"
                      >
                        {incident.incident_id}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-900 max-w-md truncate">
                      {incident.description}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-[10px] font-medium rounded-full ${getStatusColor(incident.status)}`}>
                        {incident.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600">
                      {formatDate(incident.t_created)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredIncidents.length > 10 && (
              <div className="p-4 text-center border-t border-neutral-200">
                <p className="text-xs text-neutral-500">
                  Showing 10 of {filteredIncidents.length} incidents
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
