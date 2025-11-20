'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, Users, AlertCircle } from 'lucide-react';

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
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading join requests...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center text-red-600">
          <AlertCircle className="w-12 h-12 mx-auto mb-4" />
          <p className="text-lg font-semibold">Error loading join requests</p>
          <p className="text-sm mt-2">{error}</p>
          <button
            onClick={fetchJoinRequests}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Group Join Requests</h1>
          <p className="text-gray-600 mt-2">
            Manage pending requests from Telegram groups wanting to join {companyName}
          </p>
        </div>
        <button
          onClick={fetchJoinRequests}
          className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-blue-600" />
          <div>
            <p className="text-sm text-blue-800 font-medium">Pending Requests</p>
            <p className="text-2xl font-bold text-blue-900">{joinRequests.length}</p>
          </div>
        </div>
      </div>

      {/* Join Requests List */}
      {joinRequests.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 mb-2">No Pending Requests</h3>
          <p className="text-gray-500">
            There are currently no groups requesting to join {companyName}.
            <br />
            When a Telegram group requests access, they will appear here for approval.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Group
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Requested By
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Group ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Company Requested
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {joinRequests.map((request) => (
                  <tr key={request.group_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                          <Users className="w-5 h-5 text-white" />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-gray-900">
                            {request.group_name}
                          </div>
                          <div className="text-sm text-gray-500">
                            Telegram Group
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {request.requested_by_handle || 'Unknown'}
                      </div>
                      {request.requested_by_user_id && (
                        <div className="text-sm text-gray-500">
                          ID: {request.requested_by_user_id}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-mono text-gray-700">
                        {request.group_id}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {request.requested_company_name}
                      </div>
                      {request.requested_company_name?.toLowerCase() === companyName.toLowerCase() ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 mt-1">
                          Matches your company
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 mt-1">
                          Name mismatch
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleApprove(request.group_id, request.group_name)}
                          disabled={processingId === request.group_id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                          <CheckCircle className="w-4 h-4" />
                          {processingId === request.group_id ? 'Processing...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => handleDeny(request.group_id, request.group_name)}
                          disabled={processingId === request.group_id}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                        >
                          <XCircle className="w-4 h-4" />
                          {processingId === request.group_id ? 'Processing...' : 'Deny'}
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
      <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">How It Works</h3>
        <div className="space-y-3 text-sm text-gray-700">
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
              1
            </div>
            <p>
              When a Telegram group wants to use the KPI bot, they add the bot to their group and respond to the registration prompt with your company name.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
              2
            </div>
            <p>
              The request appears here if the company name they provided matches your company name (case-insensitive).
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
              3
            </div>
            <p>
              <strong>Approve:</strong> Activates the group and allows them to use all KPI bot features. The group will be notified automatically.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold">
              4
            </div>
            <p>
              <strong>Deny:</strong> Removes the request. The group can submit a new request if needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
