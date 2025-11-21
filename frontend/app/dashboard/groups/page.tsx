'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, CheckCircle, Clock, Users, ExternalLink, X } from 'lucide-react';
import { parseJSON } from '@/lib/db';

interface Group {
  group_id: number;
  group_name: string;
  status: 'pending' | 'active';
  user_count: number;
  manager_handles: string[];
  dispatcher_user_ids: number[];
}

interface GroupUser {
  user_id: number;
  telegram_handle: string;
  first_name: string | null;
  last_name: string | null;
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupUsers, setGroupUsers] = useState<GroupUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

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

  const fetchGroupUsers = async (groupId: number) => {
    try {
      setLoadingUsers(true);
      const response = await fetch(`/api/groups/${groupId}/users`);
      if (response.ok) {
        const data = await response.json();
        setGroupUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error fetching group users:', error);
      setGroupUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const openGroupInTelegram = (groupId: number) => {
    // Telegram group links use negative chat IDs
    // Format: https://t.me/c/<positive_id>
    const positiveId = Math.abs(groupId).toString().replace(/^100/, '');
    window.open(`https://t.me/c/${positiveId}`, '_blank');
  };

  const handleUserCountClick = (group: Group) => {
    if (group.user_count > 0) {
      setSelectedGroup(group);
      fetchGroupUsers(group.group_id);
    }
  };

  const closeModal = () => {
    setSelectedGroup(null);
    setGroupUsers([]);
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
              className="tech-border bg-white p-4 tech-card cursor-pointer"
              onClick={() => openGroupInTelegram(group.group_id)}
              title="Click to open in Telegram"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 h-8 w-8 tech-border bg-white flex items-center justify-center">
                    <MessageSquare className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold tracking-wider text-neutral-900 flex items-center gap-2">
                      {group.group_name}
                      <ExternalLink className="h-3 w-3 text-neutral-500" strokeWidth={1} />
                    </h3>
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
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">Users</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleUserCountClick(group);
                    }}
                    className={`text-xs text-neutral-900 font-mono ${group.user_count > 0 ? 'underline hover:text-neutral-600' : ''}`}
                    disabled={group.user_count === 0}
                  >
                    {group.user_count}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* User List Modal */}
      {selectedGroup && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50" onClick={closeModal}>
          <div className="tech-card tech-border bg-white p-6 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold tracking-wider text-neutral-900">{selectedGroup.group_name}</h3>
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider mt-1">GROUP USERS ({groupUsers.length})</p>
              </div>
              <button
                onClick={closeModal}
                className="tech-button p-1"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loadingUsers ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-pulse-subtle text-xs uppercase tracking-wider text-neutral-500">Loading users...</div>
              </div>
            ) : groupUsers.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-8 w-8 text-neutral-400 mx-auto mb-2" strokeWidth={1} />
                <p className="text-xs uppercase tracking-wider text-neutral-500">No users found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {groupUsers.map((user) => (
                  <div key={user.user_id} className="tech-border-b pb-2">
                    <div className="text-sm text-neutral-900">
                      {user.first_name || user.last_name
                        ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                        : 'Unknown User'
                      }
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      {user.telegram_handle}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
