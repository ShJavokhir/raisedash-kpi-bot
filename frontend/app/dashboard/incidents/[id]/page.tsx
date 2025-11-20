'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatIncidentStatus, getStatusColor, calculateDuration } from '@/lib/utils';
import { ArrowLeft, Clock, User, CheckCircle, AlertCircle } from 'lucide-react';

interface IncidentDetail {
  incident: any;
  events: any[];
  participants: any[];
  claims: any[];
  departmentSessions: any[];
}

export default function IncidentDetailPage() {
  const params = useParams();
  const [data, setData] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIncidentDetail();
  }, []);

  const fetchIncidentDetail = async () => {
    try {
      const response = await fetch(`/api/incidents/${params.id}`);
      if (response.ok) {
        const data = await response.json();
        setData(data);
      }
    } catch (error) {
      console.error('Error fetching incident:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!data) {
    return <div>Incident not found</div>;
  }

  const { incident, events, participants, claims } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/incidents"
          className="inline-flex items-center text-sm text-indigo-600 hover:text-indigo-900 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Incidents
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Incident #{incident.incident_id}</h1>
            <p className="mt-2 text-sm text-gray-600">
              Created {formatDate(incident.t_created)} by{' '}
              {incident.created_by_first_name || incident.created_by_username || `User ${incident.created_by_id}`}
            </p>
          </div>
          <span className={`px-4 py-2 inline-flex text-sm leading-5 font-semibold rounded-full ${getStatusColor(incident.status)}`}>
            {formatIncidentStatus(incident.status)}
          </span>
        </div>
      </div>

      {/* Main info grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Description</h3>
            <p className="text-gray-700 whitespace-pre-wrap">{incident.description}</p>
          </div>

          {/* Resolution Summary */}
          {incident.resolution_summary && (
            <div className="bg-green-50 rounded-lg border border-green-200 p-6">
              <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center">
                <CheckCircle className="h-5 w-5 mr-2" />
                Resolution Summary
              </h3>
              <p className="text-green-800 whitespace-pre-wrap">{incident.resolution_summary}</p>
            </div>
          )}

          {/* Timeline */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Timeline</h3>
            <div className="flow-root">
              <ul className="-mb-8">
                {events.map((event, idx) => (
                  <li key={event.event_id}>
                    <div className="relative pb-8">
                      {idx !== events.length - 1 && (
                        <span
                          className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-gray-200"
                          aria-hidden="true"
                        />
                      )}
                      <div className="relative flex space-x-3">
                        <div>
                          <span className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center ring-8 ring-white">
                            <Clock className="h-4 w-4 text-indigo-600" />
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                          <div>
                            <p className="text-sm text-gray-900">
                              {event.event_type.replace('_', ' ')}
                              {event.first_name && ` by ${event.first_name}`}
                            </p>
                          </div>
                          <div className="whitespace-nowrap text-right text-sm text-gray-500">
                            {formatDate(event.at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Right column - Metadata */}
        <div className="space-y-6">
          {/* Key info */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Details</h3>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Department</dt>
                <dd className="mt-1 text-sm text-gray-900">{incident.department_name || 'Unassigned'}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Group</dt>
                <dd className="mt-1 text-sm text-gray-900">{incident.group_name}</dd>
              </div>
              {incident.t_first_claimed && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Time to Claim</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {calculateDuration(incident.t_created, incident.t_first_claimed)}
                  </dd>
                </div>
              )}
              {incident.t_resolved && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Time to Resolve</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {calculateDuration(incident.t_created, incident.t_resolved)}
                  </dd>
                </div>
              )}
              {incident.resolved_by_first_name && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Resolved By</dt>
                  <dd className="mt-1 text-sm text-gray-900">{incident.resolved_by_first_name}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Participants */}
          {participants.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Participants</h3>
              <ul className="space-y-3">
                {participants.map((participant) => (
                  <li key={participant.participant_id} className="flex items-center justify-between">
                    <div className="flex items-center">
                      <User className="h-4 w-4 text-gray-400 mr-2" />
                      <span className="text-sm text-gray-900">
                        {participant.first_name || participant.username || `User ${participant.user_id}`}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">{participant.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Active Claims */}
          {claims.filter(c => c.is_active).length > 0 && (
            <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
              <h3 className="text-lg font-semibold text-blue-900 mb-4 flex items-center">
                <AlertCircle className="h-5 w-5 mr-2" />
                Active Claims
              </h3>
              <ul className="space-y-2">
                {claims.filter(c => c.is_active).map((claim) => (
                  <li key={claim.claim_id} className="text-sm text-blue-800">
                    {claim.first_name || claim.username || `User ${claim.user_id}`}
                    {claim.department_name && ` (${claim.department_name})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
