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
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 bg-neutral-900"></div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
            Telegram <span className="font-light text-neutral-500">Groups</span>
          </h1>
        </div>
        <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
          Connected messaging channels and group configurations
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
            <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Groups...</span>
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="tech-border bg-white p-12 text-center">
          <MessageSquare className="mx-auto h-8 w-8 text-neutral-400 mb-4" strokeWidth={1} />
          <p className="text-xs uppercase tracking-wider text-neutral-500">No groups found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => (
            <div
              key={group.group_id}
              className="tech-border bg-white p-4 tech-card"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 h-8 w-8 tech-border bg-white flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900">{group.group_name}</h3>
                    <p className="text-[10px] text-neutral-500 font-mono">ID: {group.group_id}</p>
                  </div>
                </div>
                {group.status === 'active' ? (
                  <CheckCircle className="h-4 w-4 text-neutral-900" strokeWidth={1} />
                ) : (
                  <Clock className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                )}
              </div>
              <div className="space-y-2 pt-3 tech-border-t">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">Status</span>
                  <span className={`badge ${group.status === 'active' ? 'badge-open' : 'badge-closed'}`}>
                    {group.status}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">Managers</span>
                  <span className="text-xs text-neutral-900 font-mono">{group.manager_handles.length}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">Dispatchers</span>
                  <span className="text-xs text-neutral-900 font-mono">{group.dispatcher_user_ids.length}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
