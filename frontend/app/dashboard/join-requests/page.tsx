'use client';

import { useState, useEffect } from 'react';
import { Check, X, Users, AlertCircle, RefreshCw } from 'lucide-react';

interface JoinRequest {
  group_id: number;
  group_name: string;
  status: string;
  registration_message_id: number | null;
  requested_by_user_id: number | null;
  requested_by_handle: string | null;
  requested_company_name: string | null;
}

export default function JoinRequestsPage() {
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    fetchJoinRequests();
  }, []);

  const fetchJoinRequests = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/join-requests');

      if (!response.ok) {
        throw new Error('Failed to fetch join requests');
      }

      const data = await response.json();
      setJoinRequests(data.join_requests || []);
      setCompanyName(data.company_name || '');
    } catch (err) {
      console.error('Error fetching join requests:', err);
      setError(err instanceof Error ? err.message : 'Failed to load join requests');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (groupId: number, groupName: string) => {
    if (!confirm(`Are you sure you want to approve "${groupName}"? This will activate the group and allow them to use the KPI bot.`)) {
      return;
    }

    try {
      setProcessingId(groupId);
      const response = await fetch(`/api/join-requests/${groupId}/approve`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve request');
      }

      const data = await response.json();

      // Show success message
      alert(`✅ ${data.message}`);

      // Refresh the list
      await fetchJoinRequests();
    } catch (err) {
      console.error('Error approving request:', err);
      alert(`❌ Error: ${err instanceof Error ? err.message : 'Failed to approve request'}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleDeny = async (groupId: number, groupName: string) => {
    if (!confirm(`Are you sure you want to deny "${groupName}"? This action cannot be undone, and the group will need to request again.`)) {
      return;
    }

    try {
      setProcessingId(groupId);
      const response = await fetch(`/api/join-requests/${groupId}/deny`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to deny request');
      }

      const data = await response.json();

      // Show success message
      alert(`✅ ${data.message}`);

      // Refresh the list
      await fetchJoinRequests();
    } catch (err) {
      console.error('Error denying request:', err);
      alert(`❌ Error: ${err instanceof Error ? err.message : 'Failed to deny request'}`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="inline-block animate-pulse-subtle h-12 w-12 tech-border rounded mb-4"></div>
          <p className="text-sm uppercase tracking-wider text-ink/60">LOADING JOIN REQUESTS</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-ink" />
          <p className="text-sm uppercase tracking-wider font-medium mb-2">ERROR LOADING REQUESTS</p>
          <p className="text-xs text-ink/60 mb-4">{error}</p>
          <button
            onClick={fetchJoinRequests}
            className="tech-button"
          >
            RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="section-header">
        <div>
          <span className="section-tag">GROUP JOIN REQUESTS</span>
          <p className="text-xs text-ink/60 mt-2 uppercase tracking-wide">
            MANAGE PENDING REQUESTS FOR {companyName.toUpperCase()}
          </p>
        </div>
        <button
          onClick={fetchJoinRequests}
          className="tech-button flex items-center gap-2"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          REFRESH
        </button>
      </div>

      {/* Stats */}
      <div className="tech-card p-4 tech-border">
        <div className="flex items-center gap-3">
          <Users className="w-5 h-5 text-ink" />
          <div>
            <p className="text-xs text-ink/60 uppercase tracking-wider">PENDING REQUESTS</p>
            <p className="text-2xl font-bold text-ink font-mono">{joinRequests.length}</p>
          </div>
        </div>
      </div>

      {/* Join Requests List */}
      {joinRequests.length === 0 ? (
        <div className="tech-card p-12 text-center tech-border">
          <Users className="w-16 h-16 text-ink/30 mx-auto mb-4" />
          <p className="text-sm uppercase tracking-wider font-medium mb-2">NO PENDING REQUESTS</p>
          <p className="text-xs text-ink/60">
            THERE ARE CURRENTLY NO GROUPS REQUESTING TO JOIN {companyName.toUpperCase()}.
            <br />
            WHEN A TELEGRAM GROUP REQUESTS ACCESS, THEY WILL APPEAR HERE FOR APPROVAL.
          </p>
        </div>
      ) : (
        <div className="tech-card tech-border">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="tech-border-b">
                <tr className="bg-paper">
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink/60 uppercase tracking-wider">
                    GROUP
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink/60 uppercase tracking-wider">
                    REQUESTED BY
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink/60 uppercase tracking-wider">
                    GROUP ID
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-ink/60 uppercase tracking-wider">
                    COMPANY
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-ink/60 uppercase tracking-wider">
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {joinRequests.map((request) => (
                  <tr key={request.group_id} className="hover:bg-paper/50 transition-colors">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 h-8 w-8 tech-border flex items-center justify-center">
                          <Users className="w-4 h-4 text-ink" />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-ink">
                            {request.group_name}
                          </div>
                          <div className="text-xs text-ink/60 uppercase tracking-wide">
                            TELEGRAM GROUP
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm text-ink">
                        {request.requested_by_handle || 'UNKNOWN'}
                      </div>
                      {request.requested_by_user_id && (
                        <div className="text-xs text-ink/60 font-mono">
                          ID: {request.requested_by_user_id}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm font-mono text-ink">
                        {request.group_id}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-sm text-ink">
                        {request.requested_company_name}
                      </div>
                      {request.requested_company_name?.toLowerCase() === companyName.toLowerCase() ? (
                        <span className="inline-block text-xs text-ink/60 uppercase tracking-wide mt-1">
                          ✓ MATCH
                        </span>
                      ) : (
                        <span className="inline-block text-xs text-ink/60 uppercase tracking-wide mt-1">
                          ⚠ MISMATCH
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleApprove(request.group_id, request.group_name)}
                          disabled={processingId === request.group_id}
                          className="tech-button inline-flex items-center gap-1 px-3 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Approve request"
                        >
                          <Check className="w-3 h-3" />
                          {processingId === request.group_id ? 'PROCESSING' : 'APPROVE'}
                        </button>
                        <button
                          onClick={() => handleDeny(request.group_id, request.group_name)}
                          disabled={processingId === request.group_id}
                          className="tech-button inline-flex items-center gap-1 px-3 py-1 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          title="Deny request"
                        >
                          <X className="w-3 h-3" />
                          {processingId === request.group_id ? 'PROCESSING' : 'DENY'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Information Panel */}
      <div className="tech-card tech-border p-4">
        <span className="section-tag inline-block mb-3">WORKFLOW GUIDE</span>
        <div className="space-y-2 text-xs">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-5 h-5 tech-border flex items-center justify-center text-ink font-mono font-bold text-xs">
              1
            </div>
            <p className="text-ink/80 leading-relaxed">
              TELEGRAM GROUP ADDS BOT AND RESPONDS TO REGISTRATION PROMPT WITH COMPANY NAME
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-5 h-5 tech-border flex items-center justify-center text-ink font-mono font-bold text-xs">
              2
            </div>
            <p className="text-ink/80 leading-relaxed">
              REQUEST APPEARS HERE IF COMPANY NAME MATCHES (CASE-INSENSITIVE)
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-5 h-5 tech-border flex items-center justify-center text-ink font-mono font-bold text-xs">
              3
            </div>
            <p className="text-ink/80 leading-relaxed">
              <strong className="text-ink">APPROVE:</strong> ACTIVATES GROUP AND ENABLES ALL KPI BOT FEATURES. GROUP IS NOTIFIED AUTOMATICALLY.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-5 h-5 tech-border flex items-center justify-center text-ink font-mono font-bold text-xs">
              4
            </div>
            <p className="text-ink/80 leading-relaxed">
              <strong className="text-ink">DENY:</strong> REMOVES REQUEST. GROUP CAN SUBMIT NEW REQUEST IF NEEDED.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
