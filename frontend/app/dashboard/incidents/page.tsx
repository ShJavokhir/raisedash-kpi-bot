'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatDate, formatIncidentStatus, getStatusColor, truncate } from '@/lib/utils';
import { Search, Filter } from 'lucide-react';

interface Incident {
  incident_id: string;
  status: string;
  description: string;
  department_name: string;
  group_name: string;
  created_by_username: string;
  created_by_first_name: string;
  resolved_by_username: string;
  resolved_by_first_name: string;
  t_created: string;
  t_resolved: string;
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchIncidents();
  }, [statusFilter]);

  const fetchIncidents = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);

      const response = await fetch(`/api/incidents?${params}`);
      if (response.ok) {
        const data = await response.json();
        setIncidents(data.incidents);
      }
    } catch (error) {
      console.error('Error fetching incidents:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredIncidents = incidents.filter((incident) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      incident.incident_id.toLowerCase().includes(query) ||
      incident.description.toLowerCase().includes(query) ||
      incident.department_name?.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 bg-neutral-900"></div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
            Incident <span className="font-light text-neutral-500">Registry</span>
          </h1>
        </div>
        <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
          Comprehensive incident tracking and management system
        </p>
      </div>

      {/* Filters */}
      <div className="tech-border bg-white p-4">
        <div className="section-header mb-4">
          <div className="section-tag">Filter Controls</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Search */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
              Search Query
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
              <input
                type="text"
                placeholder="SEARCH INCIDENTS..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="tech-input w-full pl-10"
              />
            </div>
          </div>

          {/* Status filter */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
              Status Filter
            </label>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="tech-input w-full pl-10 appearance-none uppercase text-xs"
              >
                <option value="">All Statuses</option>
                <option value="Awaiting_Department">Awaiting Department</option>
                <option value="Awaiting_Claim">Awaiting Claim</option>
                <option value="In_Progress">In Progress</option>
                <option value="Awaiting_Summary">Awaiting Summary</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
          </div>
        </div>
        <div className="mt-3 text-[10px] text-neutral-400 uppercase tracking-wide">
          Showing {filteredIncidents.length} of {incidents.length} incidents
        </div>
      </div>

      {/* Incidents table */}
      <div className="tech-border bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
              <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Incidents...</span>
            </div>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xs uppercase tracking-wider text-neutral-500">No incidents found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-neutral-100 tech-border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Department
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredIncidents.map((incident) => (
                  <tr key={incident.incident_id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-neutral-900">
                      #{incident.incident_id}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`badge ${
                        incident.status === 'Resolved' || incident.status === 'Closed'
                          ? 'badge-resolved'
                          : incident.status === 'In_Progress'
                            ? 'badge-open'
                            : 'badge-closed'
                      }`}>
                        {formatIncidentStatus(incident.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-700 max-w-md">
                      {truncate(incident.description, 60)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600 uppercase">
                      {incident.department_name || 'Unassigned'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500 font-mono">
                      {formatDate(incident.t_created)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs">
                      <Link
                        href={`/dashboard/incidents/${incident.incident_id}`}
                        className="tech-button px-2 py-1 inline-block text-[10px]"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
