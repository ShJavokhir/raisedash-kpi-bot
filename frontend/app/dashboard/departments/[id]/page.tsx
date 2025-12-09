'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, User, Search, X } from 'lucide-react';
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

interface UserData {
  user_id: number;
  username: string;
  first_name: string;
  last_name: string;
  telegram_handle: string;
  team_role: string;
  department_ids: number[];
  group_connections: number[];
  tags: string;
  created_at: string;
}

interface Department {
  department_id: number;
  name: string;
}

interface Group {
  group_id: number;
  group_name: string;
  status: string;
}

interface GroupAssignment {
  group_id: number;
  group_name: string;
  department_id: number;
  department_name: string;
  schedule: Array<{
    day: string;
    enabled: boolean;
    start_time: string;
    end_time: string;
  }>;
  added_at: string;
}

type DayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

interface DaySchedule {
  day: DayName;
  enabled: boolean;
  start_time: string;
  end_time: string;
}

const DAY_ORDER: DayName[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABEL: Record<DayName, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};

export default function DepartmentMembersPage() {
  const params = useParams();
  const [members, setMembers] = useState<DepartmentMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [showAssignGroupModal, setShowAssignGroupModal] = useState(false);
  const [assignUser, setAssignUser] = useState<UserData | null>(null);
  const [groupAssignments, setGroupAssignments] = useState<Record<number, GroupAssignment[]>>({});
  const [assignLoading, setAssignLoading] = useState(false);
  const [groupSearch, setGroupSearch] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>('');
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const [tagFeedback, setTagFeedback] = useState<string | null>(null);
  const [tagError, setTagError] = useState<string | null>(null);

  useEffect(() => {
    fetchMembers();
    fetchUsers();
    fetchDepartments();
    fetchGroups();
  }, []);

  useEffect(() => {
    if (assignUser) {
      setTagInput(assignUser.tags || '');
      setTagFeedback(null);
      setTagError(null);
    } else {
      setTagInput('');
      setTagFeedback(null);
      setTagError(null);
    }
  }, [assignUser]);

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
        const normalized = (data.users || []).map((user: any) => ({
          ...user,
          tags: user.tags || '',
          department_ids: user.department_ids || [],
          group_connections: user.group_connections || [],
        }));
        setAvailableUsers(normalized);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await fetch('/api/departments');
      if (response.ok) {
        const data = await response.json();
        setDepartments(data.departments || []);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await fetch('/api/groups');
      if (response.ok) {
        const data = await response.json();
        setGroups(data.groups || []);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
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

  const parseHHMM = (value: string): number | null => {
    if (!value) return null;
    const parts = value.trim().split(':');
    if (parts.length !== 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (
      Number.isNaN(hours) ||
      Number.isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }
    return hours * 60 + minutes;
  };

  const buildDefaultSchedule = (): DaySchedule[] =>
    DAY_ORDER.map((day) => ({
      day,
      enabled: true,
      start_time: '07:00',
      end_time: '19:00',
    }));

  const summarizeSchedule = (entries: DaySchedule[]): string => {
    const enabled = entries.filter((d) => d.enabled);
    if (enabled.length === 0) return 'Disabled';
    return enabled
      .map((d) => `${DAY_LABEL[d.day]} ${d.start_time}-${d.end_time}`)
      .join(', ');
  };

  const toggleDay = (day: DayName) => {
    setSchedule((prev) =>
      prev.map((entry) =>
        entry.day === day ? { ...entry, enabled: !entry.enabled } : entry
      )
    );
  };

  const updateDayTime = (day: DayName, field: 'start_time' | 'end_time', value: string) => {
    setSchedule((prev) =>
      prev.map((entry) =>
        entry.day === day ? { ...entry, [field]: value } : entry
      )
    );
  };

  const getUserDisplayName = (user: UserData) => {
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return user.username || user.telegram_handle || `User ${user.user_id}`;
  };

  const fetchGroupAssignments = async (userId: number) => {
    setAssignLoading(true);
    try {
      const response = await fetch(`/api/group-members?user_id=${userId}`);
      if (response.ok) {
        const data = await response.json();
        setAssignError(null);
        setGroupAssignments((prev) => ({
          ...prev,
          [userId]: data.assignments || [],
        }));
      } else {
        const data = await response.json();
        setAssignError(data.error || 'Failed to load assignments');
      }
    } catch (error) {
      console.error('Error fetching group assignments:', error);
      setAssignError('Failed to load assignments');
    } finally {
      setAssignLoading(false);
    }
  };

  const openAssignGroupModal = (user: UserData) => {
    setAssignUser(user);
    setGroupSearch('');
    setSelectedGroupIds([]);
    setSelectedDepartmentId('');
    setSchedule(buildDefaultSchedule());
    setAssignError(null);
    setShowAssignGroupModal(true);
    fetchGroupAssignments(user.user_id);
  };

  const closeAssignGroupModal = () => {
    setShowAssignGroupModal(false);
    setAssignUser(null);
    setAssignError(null);
    setGroupSearch('');
    setSelectedGroupIds([]);
    setSelectedDepartmentId('');
    setSchedule(buildDefaultSchedule());
    setTagInput('');
    setTagFeedback(null);
    setTagError(null);
  };

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const handleAddGroupAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignUser || selectedGroupIds.length === 0 || !selectedDepartmentId) return;

    const enabledDays = schedule.filter((day) => day.enabled);
    if (enabledDays.length === 0) {
      setAssignError('Enable at least one day.');
      return;
    }

    for (const day of enabledDays) {
      const start = parseHHMM(day.start_time);
      const end = parseHHMM(day.end_time);
      if (start === null || end === null) {
        setAssignError('Provide start and end times in HH:MM (00:00-23:59) for all enabled days.');
        return;
      }
      if (start === end) {
        setAssignError('Start and end times cannot be identical. Use 00:00-23:59 for 24/7 coverage.');
        return;
      }
    }

    setSavingAssignment(true);
    setAssignError(null);
    try {
      const payloads = selectedGroupIds.map((groupId) => ({
        group_id: parseInt(groupId),
      }));

      const errors: string[] = [];
      for (const payload of payloads) {
        const response = await fetch('/api/group-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: assignUser.user_id,
            group_id: payload.group_id,
            department_id: parseInt(selectedDepartmentId),
            schedule,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          errors.push(data.error || `Failed for group ${payload.group_id}`);
        }
      }

      if (errors.length > 0) {
        setAssignError(errors.join('\n'));
      } else {
        setAssignError(null);
        setSelectedGroupIds([]);
      }
      await fetchGroupAssignments(assignUser.user_id);
    } catch (error) {
      console.error('Error adding group assignment:', error);
      setAssignError('Failed to add assignment');
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleRemoveAssignment = async (assignment: GroupAssignment) => {
    if (!assignUser) return;
    const params = new URLSearchParams({
      user_id: String(assignUser.user_id),
      group_id: String(assignment.group_id),
      department_id: String(assignment.department_id),
    });

    try {
      const response = await fetch(`/api/group-members?${params.toString()}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchGroupAssignments(assignUser.user_id);
      } else {
        const data = await response.json();
        setAssignError(data.error || 'Failed to remove assignment');
      }
    } catch (error) {
      console.error('Error removing group assignment:', error);
      setAssignError('Failed to remove assignment');
    }
  };

  const handleSaveTags = async () => {
    if (!assignUser) return;
    setSavingTags(true);
    setTagFeedback(null);
    setTagError(null);

    try {
      const response = await fetch(`/api/users/${assignUser.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagInput }),
      });

      if (!response.ok) {
        const data = await response.json();
        setTagError(data.error || 'Failed to update tags');
        return;
      }

      const data = await response.json();
      const normalizedTags = typeof data.tags === 'string' ? data.tags : tagInput.trim();
      setTagInput(normalizedTags);
      setTagFeedback('Tags saved');
      setAvailableUsers((prev) =>
        prev.map((u) =>
          u.user_id === assignUser.user_id ? { ...u, tags: normalizedTags } : u
        )
      );
      setAssignUser((prev) =>
        prev ? { ...prev, tags: normalizedTags } : prev
      );
    } catch (error) {
      console.error('Error saving tags:', error);
      setTagError('Failed to update tags');
    } finally {
      setSavingTags(false);
    }
  };

  const handleOpenAssignForMember = (userId: number) => {
    const userData = availableUsers.find((u) => u.user_id === userId);
    if (!userData) {
      alert('User details are still loading. Please try again in a moment.');
      return;
    }
    openAssignGroupModal(userData);
  };

  const memberUserIds = new Set(members.map(m => m.user_id));
  let usersToAdd = availableUsers.filter(u => !memberUserIds.has(u.user_id));

  // Filter users based on search query
  if (userSearchQuery.trim()) {
    const query = userSearchQuery.toLowerCase();
    usersToAdd = usersToAdd.filter(user => {
      const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
      const username = (user.username || '').toLowerCase();
      const userId = user.user_id.toString();
      return fullName.includes(query) || username.includes(query) || userId.includes(query);
    });
  }

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

  const assignmentList = assignUser ? (groupAssignments[assignUser.user_id] || []) : [];
  const userDepartments = assignUser
    ? departments.filter((d) => assignUser.department_ids.includes(d.department_id))
    : [];
  const filteredGroupOptions = groups.filter((group) => {
    const matchesSearch =
      group.group_name.toLowerCase().includes(groupSearch.toLowerCase()) ||
      String(group.group_id).includes(groupSearch.trim());
    return group.status === 'active' && matchesSearch;
  });

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
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-wider">
                    Assignments
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
                          <Link
                            href={`/dashboard/users/${member.user_id}`}
                            className="text-sm font-semibold text-neutral-900 hover:text-neutral-600 hover:underline"
                          >
                            {member.first_name || member.last_name
                              ? `${member.first_name || ''} ${member.last_name || ''}`.trim()
                              : `User ${member.user_id}`}
                          </Link>
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
                    <td className="px-6 py-4 whitespace-nowrap text-xs">
                      <button
                        onClick={() => handleOpenAssignForMember(member.user_id)}
                        className="tech-button px-3 py-1 text-[11px]"
                      >
                        Manage
                      </button>
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

      {/* Group Assignments Modal */}
      {showAssignGroupModal && assignUser && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50 p-4" onClick={closeAssignGroupModal}>
          <div
            className="tech-card tech-border bg-white w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between shrink-0 bg-white">
              <div>
                <h3 className="text-lg font-bold tracking-tight text-neutral-900">{getUserDisplayName(assignUser)}</h3>
                <p className="text-xs text-neutral-500 font-medium">Manage Group Assignments</p>
                <p className="text-[10px] text-neutral-500 mt-1">
                  Tags: <span className="font-mono text-neutral-900">{(assignUser.tags || '').trim() || 'Not set'}</span>
                </p>
              </div>
              <button
                onClick={closeAssignGroupModal}
                className="p-2 hover:bg-neutral-100 rounded-full transition-colors text-neutral-500 hover:text-neutral-900"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 bg-neutral-50/30">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Left Column: Form (7/12) */}
                <div className="lg:col-span-7 space-y-6">
                  <form onSubmit={handleAddGroupAssignment} className="space-y-6">
                    {assignError && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-lg">
                        {assignError}
                      </div>
                    )}

                    <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm space-y-4">
                      <div className="flex items-center justify-between pb-2 border-b border-neutral-100">
                        <div className="flex items-center gap-2">
                          <div className="w-1.5 h-1.5 bg-neutral-900 rounded-full"></div>
                          <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">Reporting Tags</h4>
                        </div>
                        {tagFeedback && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                            Saved
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-neutral-500 leading-relaxed">
                        Keep a simple, comma-separated string for reporting (e.g. region, shift, lane).
                      </p>
                      <div className="flex flex-col sm:flex-row gap-3">
                        <input
                          type="text"
                          value={tagInput}
                          onChange={(e) => {
                            setTagInput(e.target.value);
                            setTagFeedback(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (!savingTags) {
                                handleSaveTags();
                              }
                            }
                          }}
                          placeholder="e.g., Night Shift, West Region"
                          className="tech-input w-full"
                        />
                        <button
                          type="button"
                          onClick={handleSaveTags}
                          className="tech-button !bg-neutral-900 !text-white hover:!bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={savingTags || !assignUser}
                        >
                          {savingTags ? 'Saving...' : 'Save Tags'}
                        </button>
                      </div>
                      {(tagError || tagFeedback) && (
                        <div className={`text-[10px] ${tagError ? 'text-red-600' : 'text-green-700'}`}>
                          {tagError || tagFeedback}
                        </div>
                      )}
                    </div>

                    <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm space-y-5">
                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-neutral-100">
                         <div className="w-1.5 h-1.5 bg-neutral-900 rounded-full"></div>
                         <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">New Assignment Details</h4>
                      </div>

                      {/* Department */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                          1. Select Department
                        </label>
                        <select
                          value={selectedDepartmentId}
                          onChange={(e) => setSelectedDepartmentId(e.target.value)}
                          className="tech-input w-full"
                          required
                          disabled={userDepartments.length === 0}
                        >
                          <option value="">Select department...</option>
                          {userDepartments.map((dept) => (
                            <option key={dept.department_id} value={dept.department_id}>
                              {dept.name}
                            </option>
                          ))}
                        </select>
                        {userDepartments.length === 0 && (
                          <p className="text-[10px] text-red-600 mt-1">
                            User must be added to a department before assigning to a group.
                          </p>
                        )}
                      </div>

                      {/* Groups */}
                      <div className="space-y-3">
                        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                          2. Select Groups ({selectedGroupIds.length} selected)
                        </label>
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
                          <input
                            type="text"
                            value={groupSearch}
                            onChange={(e) => setGroupSearch(e.target.value)}
                            placeholder="Search groups by name or ID..."
                            className="tech-input w-full pl-10"
                          />
                        </div>
                        <div className="border border-neutral-200 rounded-lg bg-white h-52 overflow-y-auto custom-scrollbar">
                          {filteredGroupOptions.length === 0 ? (
                            <div className="p-4 text-xs text-neutral-500 text-center">No matching groups found</div>
                          ) : (
                            <div className="divide-y divide-neutral-100">
                              {filteredGroupOptions.map((group) => {
                                const active = selectedGroupIds.includes(String(group.group_id));
                                return (
                                  <label
                                    key={group.group_id}
                                    className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                                      active ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50 text-neutral-700'
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <input
                                        type="checkbox"
                                        value={group.group_id}
                                        checked={active}
                                        onChange={() => toggleGroupSelection(String(group.group_id))}
                                        className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                                      />
                                      <div>
                                        <div className="text-sm font-semibold">
                                          {group.group_name}
                                        </div>
                                        <div className={`text-[10px] font-mono ${active ? 'text-neutral-300' : 'text-neutral-400'}`}>
                                          ID: {group.group_id}
                                        </div>
                                      </div>
                                    </div>
                                    {group.status !== 'active' && (
                                      <span className="text-[10px] px-2 py-0.5 rounded bg-neutral-200 text-neutral-600">{group.status}</span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Availability */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                          3. Availability Schedule
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {schedule.map((day) => (
                            <div key={day.day} className={`p-3 rounded-lg border transition-colors ${day.enabled ? 'border-neutral-300 bg-white' : 'border-neutral-100 bg-neutral-50 opacity-70'}`}>
                              <div className="flex items-center justify-between mb-2">
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={day.enabled}
                                    onChange={() => toggleDay(day.day)}
                                    className="rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900"
                                  />
                                  <span className="text-xs font-bold uppercase tracking-wider">{DAY_LABEL[day.day]}</span>
                                </label>
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="time"
                                  value={day.start_time}
                                  onChange={(e) => updateDayTime(day.day, 'start_time', e.target.value)}
                                  className="block w-full text-xs border-neutral-300 rounded focus:border-neutral-900 focus:ring-neutral-900 bg-transparent disabled:cursor-not-allowed"
                                  disabled={!day.enabled}
                                />
                                <span className="text-neutral-400 text-xs">to</span>
                                <input
                                  type="time"
                                  value={day.end_time}
                                  onChange={(e) => updateDayTime(day.day, 'end_time', e.target.value)}
                                  className="block w-full text-xs border-neutral-300 rounded focus:border-neutral-900 focus:ring-neutral-900 bg-transparent disabled:cursor-not-allowed"
                                  disabled={!day.enabled}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-neutral-400 mt-2 italic">
                          * Times are in server time. Use 00:00-23:59 for 24 hours.
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition-colors"
                        onClick={closeAssignGroupModal}
                        disabled={savingAssignment}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="tech-button !bg-neutral-900 !text-white hover:!bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                        disabled={
                          savingAssignment ||
                          selectedGroupIds.length === 0 ||
                          !selectedDepartmentId ||
                          schedule.length === 0 ||
                          userDepartments.length === 0
                        }
                      >
                        {savingAssignment ? 'Saving Assignment...' : 'Add Assignment'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Right Column: Assignments (5/12) */}
                <div className="lg:col-span-5">
                  <div className="bg-white rounded-xl border border-neutral-200 shadow-sm h-full flex flex-col">
                    <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-neutral-900 rounded-full"></div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">Existing Assignments</h4>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 bg-neutral-100 rounded-full text-neutral-600 font-mono">{assignmentList.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                      {assignLoading ? (
                        <div className="flex items-center justify-center h-32 text-xs text-neutral-500 gap-2">
                          <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
                          Loading assignments...
                        </div>
                      ) : assignmentList.length === 0 ? (
                        <p className="text-xs text-neutral-400 text-center py-6">No active assignments found.</p>
                      ) : (
                        <div className="divide-y divide-neutral-100">
                          {assignmentList.map((assignment, idx) => (
                            <div key={`${assignment.group_id}-${assignment.department_id}-${idx}`} className="p-4 hover:bg-neutral-50 transition-colors group">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="font-bold text-sm text-neutral-900">{assignment.group_name}</div>
                                  <div className="text-[10px] text-neutral-500 font-mono">ID: {assignment.group_id} • {assignment.department_name}</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveAssignment(assignment)}
                                  className="text-[10px] px-2 py-1 rounded border border-neutral-200 hover:border-red-300 hover:text-red-600 transition-colors"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className="text-[10px] text-neutral-500 mt-2">
                                {summarizeSchedule(Array.isArray(assignment.schedule) ? assignment.schedule as DaySchedule[] : [])}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

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
                <label htmlFor="user-search" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                  Search Users
                </label>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
                  <input
                    id="user-search"
                    type="text"
                    placeholder="Name, username, or ID..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="tech-input w-full pl-10"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label htmlFor="user" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                  Select User ({usersToAdd.length} available)
                </label>
                <select
                  id="user"
                  required
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="tech-input w-full max-h-48 overflow-y-auto"
                  size={Math.min(usersToAdd.length + 1, 8)}
                >
                  <option value="">Select a user...</option>
                  {usersToAdd.map((user) => (
                    <option key={user.user_id} value={user.user_id}>
                      {user.first_name || user.last_name
                        ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                        : user.username || `User ${user.user_id}`}
                      {user.username && ` (@${user.username})`}
                    </option>
                  ))}
                </select>
                {usersToAdd.length === 0 && (
                  <p className="mt-2 text-[10px] text-neutral-500 font-mono uppercase tracking-wider">
                    {userSearchQuery ? 'No users match your search.' : 'All users are already members.'}
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
                              ? '!bg-neutral-900 !text-white'
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
                                selectedUserId === String(user.user_id) ? '!text-white' : 'text-neutral-900'
                              }`}>
                                {user.first_name || user.last_name
                                  ? `${user.first_name || ''} ${user.last_name || ''}`.trim()
                                  : `User ${user.user_id}`}
                              </div>
                              <div className={`text-xs font-mono truncate ${
                                selectedUserId === String(user.user_id) ? '!text-neutral-300' : 'text-neutral-500'
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
                    setUserSearchQuery('');
                  }}
                  className="tech-button"
                  disabled={adding}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding || !selectedUserId}
                  className="tech-button !bg-neutral-900 !text-white hover:!bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
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
