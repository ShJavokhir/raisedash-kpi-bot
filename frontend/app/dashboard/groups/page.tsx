'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, CheckCircle, Clock } from 'lucide-react';
import { parseJSON } from '@/lib/db';

interface Group {
  group_id: number;
  group_name: string;
  status: 'pending' | 'active';
  manager_handles: string[];
  dispatcher_user_ids: number[];
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/groups');
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Telegram Groups</h1>
        <p className="mt-2 text-sm text-gray-600">
          View all Telegram groups connected to your company
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <MessageSquare className="mx-auto h-12 w-12 text-gray-400" />
          <p className="mt-4 text-gray-500">No groups found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((group) => (
            <div
              key={group.group_id}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center">
                  <div className="flex-shrink-0 h-12 w-12 bg-blue-100 rounded-lg flex items-center justify-center">
                    <MessageSquare className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-semibold text-gray-900">{group.group_name}</h3>
                    <p className="text-sm text-gray-500">ID: {group.group_id}</p>
                  </div>
                </div>
                {group.status === 'active' ? (
                  <CheckCircle className="h-5 w-5 text-green-600" />
                ) : (
                  <Clock className="h-5 w-5 text-yellow-600" />
                )}
              </div>
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Status</span>
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${
                      group.status === 'active'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {group.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Managers</span>
                  <span className="text-gray-900">{group.manager_handles.length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Dispatchers</span>
                  <span className="text-gray-900">{group.dispatcher_user_ids.length}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
