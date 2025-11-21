'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatIncidentStatus, getStatusColor, calculateDuration } from '@/lib/utils';
import { ArrowLeft, Clock, User, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';

const openIncidentInTelegram = (groupId: number, messageId: number) => {
  if (!groupId || !messageId) {
    alert('Unable to open in Telegram: Missing group or message information');
    return;
  }
  const positiveId = Math.abs(groupId).toString().replace(/^100/, '');
  window.open(`https://t.me/c/${positiveId}/${messageId}`, '_blank');
};

interface IncidentDetail {
  incident: any;
  events: any[];
  participants: any[];
  claims: any[];
  departmentSessions: any[];
}

const formatEventActor = (event: any) => {
  if (event.first_name || event.last_name) {
    return [event.first_name, event.last_name].filter(Boolean).join(' ');
  }
  if (event.username) return event.username;
  if (event.actor_user_id) return `User ${event.actor_user_id}`;
  return 'System';
};

const describeEvent = (event: any) => {
  const actor = formatEventActor(event);
  const metadata = event.metadata || {};

  switch (event.event_type) {
    case 'department_assigned': {
      const toDept = metadata.department_name || 'the department';
      if (metadata.previous_department_name) {
        return `${actor} moved department from ${metadata.previous_department_name} to ${toDept}`;
      }
      return `${actor} assigned the incident to ${toDept}`;
    }
    case 'claim':
      return metadata.is_first_claim
        ? `${actor} claimed the incident for ${metadata.department_name || 'the department'}`
        : `${actor} joined the claim for ${metadata.department_name || 'the department'}`;
    case 'release': {
      const remaining =
        typeof metadata.remaining_active === 'number'
          ? `${metadata.remaining_active} active ${metadata.remaining_active === 1 ? 'claimer' : 'claimers'} remaining`
          : null;
      const deptPart = metadata.department_name ? ` for ${metadata.department_name}` : '';
      return `${actor} released their claim${deptPart}${remaining ? ` (${remaining})` : ''}`;
    }
    case 'resolution_requested':
      return `Awaiting resolution summary from ${actor}${metadata.department_name ? ` (${metadata.department_name})` : ''}`;
    case 'resolve':
      return `${actor} resolved the incident${metadata.department_name ? ` for ${metadata.department_name}` : ''}`;
    case 'auto_closed':
      return `Incident auto-closed${metadata.reason ? `: ${metadata.reason}` : ''}`;
    case 'create':
      return `${actor} created the incident`;
    default:
      return `${(event.event_type || '').replace(/_/g, ' ')}` + (actor ? ` by ${actor}` : '');
  }
};

const getEventDetail = (event: any) => {
  const metadata = event.metadata || {};

  switch (event.event_type) {
    case 'department_assigned': {
      if (!metadata.previous_department_name && !metadata.department_name) return null;
      const prev = metadata.previous_department_name || 'Unassigned';
      const next = metadata.department_name || 'Unknown department';
      return `${prev} -> ${next}`;
    }
    case 'release':
      if (typeof metadata.remaining_active === 'number') {
        return `${metadata.remaining_active} active ${metadata.remaining_active === 1 ? 'claimer' : 'claimers'} remaining`;
      }
      return null;
    default:
      return null;
  }
};

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
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
          <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Incident...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="tech-border bg-white p-6">
        <span className="text-xs uppercase tracking-wider text-neutral-500">Incident not found</span>
      </div>
    );
  }

  const { incident, events, participants, claims } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/incidents"
          className="inline-flex items-center text-xs uppercase tracking-wider text-neutral-600 hover:text-neutral-900 mb-4 transition-colors"
        >
          <ArrowLeft className="h-3 w-3 mr-1" strokeWidth={1} />
          Back to Registry
        </Link>
        <div className="border-b-2 border-neutral-800 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 bg-neutral-900"></div>
                <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
                  Incident <span className="font-light text-neutral-500">#{incident.incident_id}</span>
                </h1>
              </div>
              <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
                Created {formatDate(incident.t_created)} by{' '}
                <Link
                  href={`/dashboard/users/${incident.created_by_id}`}
                  className="text-neutral-700 hover:text-blue-600 hover:underline font-medium"
                >
                  {incident.created_by_first_name || incident.created_by_username || `User ${incident.created_by_id}`}
                </Link>
              </p>
            </div>
            <div className="flex items-center gap-2">
              {incident.group_id && incident.pinned_message_id && (
                <button
                  onClick={() => openIncidentInTelegram(incident.group_id, incident.pinned_message_id)}
                  className="tech-button px-3 py-1.5 inline-flex items-center gap-2 text-[10px]"
                  title="Open in Telegram"
                >
                  <ExternalLink className="h-3 w-3" strokeWidth={1} />
                  VIEW IN TG
                </button>
              )}
              <span className={`badge ${
                incident.status === 'Resolved' || incident.status === 'Closed'
                  ? 'badge-resolved'
                  : incident.status === 'In_Progress'
                    ? 'badge-open'
                    : 'badge-closed'
              }`}>
                {formatIncidentStatus(incident.status)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main info grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column - Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Description */}
          <div className="tech-border bg-white p-4">
            <div className="section-header mb-4">
              <div className="section-tag">Description</div>
            </div>
            <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">{incident.description}</p>
          </div>

          {/* Resolution Summary */}
          {incident.resolution_summary && (
            <div className="tech-border bg-neutral-50 p-4">
              <div className="section-header mb-4">
                <div className="section-tag">Resolution Summary</div>
                <CheckCircle className="h-4 w-4 text-neutral-500" strokeWidth={1} />
              </div>
              <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">{incident.resolution_summary}</p>
            </div>
          )}

          {/* Timeline */}
          <div className="tech-border bg-white p-4">
            <div className="section-header mb-4">
              <div className="section-tag">Event Timeline</div>
            </div>
            <div className="flow-root">
              <ul className="-mb-6">
                {events.map((event, idx) => {
                  const detail = getEventDetail(event);
                  return (
                    <li key={event.event_id}>
                      <div className="relative pb-6">
                        {idx !== events.length - 1 && (
                          <span
                            className="absolute top-3 left-1 -ml-px h-full w-px bg-neutral-300"
                            aria-hidden="true"
                          />
                        )}
                        <div className="relative flex space-x-3">
                          <div>
                            <span className="h-2 w-2 bg-neutral-900 flex items-center justify-center">
                            </span>
                          </div>
                          <div className="flex min-w-0 flex-1 justify-between space-x-4">
                            <div>
                              <p className="text-xs text-neutral-900 font-semibold">{describeEvent(event)}</p>
                              {detail && (
                                <p className="text-[11px] text-neutral-500 mt-1">{detail}</p>
                              )}
                            </div>
                            <div className="whitespace-nowrap text-right text-[10px] text-neutral-500 font-mono">
                              {formatDate(event.at)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>

        {/* Right column - Metadata */}
        <div className="space-y-6">
          {/* Key info */}
          <div className="tech-border bg-white p-4">
            <div className="section-header mb-4">
              <div className="section-tag">Metadata</div>
            </div>
            <dl className="space-y-3">
              <div className="py-2 tech-border-b">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Department</dt>
                <dd className="text-xs text-neutral-900 tracking-wide">{incident.department_name || 'Unassigned'}</dd>
              </div>
              <div className="py-2 tech-border-b">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Group</dt>
                <dd className="text-xs text-neutral-900 tracking-wide">{incident.group_name}</dd>
              </div>
              {incident.t_first_claimed && (
                <div className="py-2 tech-border-b">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Time to First Response</dt>
                  <dd className="text-xs text-neutral-900 font-mono">
                    {calculateDuration(incident.t_created, incident.t_first_claimed)}
                  </dd>
                </div>
              )}
              {incident.t_resolved && (
                <div className="py-2 tech-border-b">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Time to Resolve</dt>
                  <dd className="text-xs text-neutral-900 font-mono">
                    {calculateDuration(incident.t_created, incident.t_resolved)}
                  </dd>
                </div>
              )}
              {incident.resolved_by_first_name && incident.resolved_by_user_id && (
                <div className="py-2">
                  <dt className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">Resolved By</dt>
                  <dd className="text-xs text-neutral-900 uppercase tracking-wide">
                    <Link
                      href={`/dashboard/users/${incident.resolved_by_user_id}`}
                      className="hover:text-blue-600 hover:underline"
                    >
                      {incident.resolved_by_first_name}
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Participants */}
          {participants.length > 0 && (
            <div className="tech-border bg-white p-4">
              <div className="section-header mb-4">
                <div className="section-tag">Participants</div>
              </div>
              <ul className="space-y-2">
                {participants.map((participant) => (
                  <li key={participant.participant_id} className="flex items-center justify-between py-2 tech-border-b last:border-0">
                    <div className="flex items-center">
                      <User className="h-3 w-3 text-neutral-400 mr-2" strokeWidth={1} />
                      <Link
                        href={`/dashboard/users/${participant.user_id}`}
                        className="text-xs text-neutral-900 tracking-wide underline hover:text-neutral-600 transition-colors"
                      >
                        {participant.first_name || participant.username || `User ${participant.user_id}`}
                      </Link>
                    </div>
                    <span className="text-[10px] text-neutral-500 tracking-wider capitalize">{participant.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Active Claims */}
          {claims.filter(c => c.is_active).length > 0 && (
            <div className="tech-border bg-neutral-50 p-4">
              <div className="section-header mb-4">
                <div className="section-tag">Active Claims</div>
                <AlertCircle className="h-4 w-4 text-neutral-500" strokeWidth={1} />
              </div>
              <ul className="space-y-2">
                {claims.filter(c => c.is_active).map((claim) => (
                  <li key={claim.claim_id} className="text-xs text-neutral-900 py-1">
                    <span className="tracking-wide">
                      {claim.first_name || claim.username || `User ${claim.user_id}`}
                    </span>
                    {claim.department_name && (
                      <span className="text-[10px] text-neutral-500 ml-2">({claim.department_name})</span>
                    )}
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
