'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, User, Search } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface DepartmentMember {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  telegram_handle: string;
  team_role: string;
  added_at: string;
}

interface User {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
}

export default function DepartmentMembersPage() {
  const params = useParams();
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchMembers();
    fetchUsers();
  }, []);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/departments/${params.id}/members`);
      if (response.ok) {
        const data = await response.json();
        setMembers(data.members);
      }
    } catch (error) {
      console.error('Error fetching members:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setAvailableUsers(data.users);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);

    try {
      const response = await fetch(`/api/departments/${params.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: parseInt(selectedUserId) }),
      });

      if (response.ok) {
        setShowAddModal(false);
        setSelectedUserId('');
        fetchMembers();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to add member');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('Are you sure you want to remove this member?')) return;

    try {
      const response = await fetch(
        `/api/departments/${params.id}/members?user_id=${userId}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        fetchMembers();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to remove member');
      }
    } catch (error) {
      alert('An error occurred');
    }
  };

  const memberUserIds = new Set(members.map(m => m.user_id));
  const usersToAdd = availableUsers.filter(u => !memberUserIds.has(u.user_id));

  // Client-side search filter for users
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return usersToAdd;

    const query = searchQuery.toLowerCase().trim();
    return usersToAdd.filter(user => {
      const searchableText = [
        user.first_name,
        user.last_name,
        user.username,
        `${user.first_name} ${user.last_name}`,
        `user ${user.user_id}`
      ].filter(Boolean).join(' ').toLowerCase();

      return searchableText.includes(query);
    });
  }, [usersToAdd, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="border-b-2 border-neutral-800 pb-4">
        <Link
          href="/dashboard/departments"
          className="inline-flex items-center text-[10px] uppercase tracking-wider text-neutral-600 hover:text-neutral-900 mb-4 font-semibold"
        >
          <ArrowLeft className="h-3 w-3 mr-1" strokeWidth={1} />
          Back to Departments
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 bg-neutral-900"></div>
              <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
                Department <span className="font-light text-neutral-500">Members</span>
              </h1>
            </div>
            <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
              Manage departmental access and member assignments
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="tech-button flex items-center gap-2 no-print"
          >
            <Plus className="h-3 w-3" strokeWidth={1} />
            Add Member
          </button>
        </div>
      </div>

      {/* Members list */}
      <div className="tech-border bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
              <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Members...</span>
            </div>
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-12">
            <User className="mx-auto h-8 w-8 text-neutral-400 mb-4" strokeWidth={1} />
            <p className="text-xs uppercase tracking-wider text-neutral-500 mb-4">No members yet</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="tech-button"
            >
              Add First Member
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="tech-border-b bg-subtle">
                <tr>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                    Added
                  </th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border">
                {members.map((member) => (
                  <tr key={member.user_id} className="hover:bg-subtle transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8 tech-border bg-white flex items-center justify-center">
                          <User className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-semibold text-neutral-900">
                            {member.first_name || member.last_name
                              ? `${member.first_name || ''} ${member.last_name || ''}`.trim()
                              : `User ${member.user_id}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-neutral-600">
                      {member.username || member.telegram_handle || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="badge">
                        {member.team_role || 'N/A'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                      {formatDate(member.added_at)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => handleRemoveMember(member.user_id)}
                        className="p-1 text-neutral-400 hover:text-neutral-900 transition-colors"
                        title="Remove member"
                      >
                        <Trash2 className="h-3 w-3" strokeWidth={1} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add member modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-neutral-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="tech-border bg-white p-6 max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="section-header mb-6">
              <div className="section-tag">Add Member</div>
            </div>

            <form onSubmit={handleAddMember} className="flex flex-col flex-1 min-h-0">
              {/* Search input */}
              <div className="mb-4">
                <label htmlFor="search" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                  Search Users
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
                  <input
                    id="search"
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name, username, or ID..."
                    className="tech-input w-full pl-10 uppercase placeholder:normal-case"
                    autoComplete="off"
                  />
                </div>
                {searchQuery && (
                  <p className="mt-2 text-[10px] text-neutral-500 font-mono">
                    Found {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
                  </p>
                )}
              </div>

              {/* User list */}
              <div className="flex-1 min-h-0 mb-6">
                <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                  Available Users ({usersToAdd.length})
                </label>
                <div className="tech-border bg-white max-h-64 overflow-y-auto custom-scrollbar">
                  {filteredUsers.length === 0 ? (
                    <div className="p-8 text-center">
                      <User className="mx-auto h-8 w-8 text-neutral-400 mb-2" strokeWidth={1} />
                      <p className="text-xs uppercase tracking-wider text-neutral-500">
                        {searchQuery ? 'No users match your search' : 'No users available'}
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {filteredUsers.map((user) => (
                        <label
                          key={user.user_id}
                          className={`flex items-center p-3 cursor-pointer transition-colors ${
                            selectedUserId === String(user.user_id)
                              ? 'bg-neutral-900 text-white'
                              : 'hover:bg-subtle'
                          }`}
                        >
                          <input
                            type="radio"
                            name="user"
                            value={user.user_id}
                            checked={selectedUserId === String(user.user_id)}
                            onChange={(e) => setSelectedUserId(e.target.value)}
                            className="mr-3 h-4 w-4"
                          />
                          <div className="flex items-center flex-1 min-w-0">
                            <div className={`flex-shrink-0 h-8 w-8 tech-border flex items-center justify-center ${
                              selectedUserId === String(user.user_id) ? 'bg-white' : 'bg-white'
                            }`}>
                              <User className={`h-4 w-4 ${
                                selectedUserId === String(user.user_id) ? 'text-neutral-900' : 'text-neutral-500'
                              }`} strokeWidth={1} />
                            </div>
                            <div className="ml-3 min-w-0 flex-1">
                              <div className={`text-sm font-semibold truncate ${
                                selectedUserId === String(user.user_id) ? 'text-white' : 'text-neutral-900'
                              }`}>
                                {user.first_name || user.last_name
                                  ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                                  : `User ${user.user_id}`}
                              </div>
                              <div className={`text-xs font-mono truncate ${
                                selectedUserId === String(user.user_id) ? 'text-neutral-300' : 'text-neutral-500'
                              }`}>
                                {user.username || `ID: ${user.user_id}`}
                              </div>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 tech-border-t">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setSelectedUserId('');
                    setSearchQuery('');
                  }}
                  className="tech-button"
                  disabled={adding}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding || !selectedUserId}
                  className="tech-button bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {adding ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
