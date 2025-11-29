'use client';

import { useEffect, useState } from 'react';
import { User, Search, Filter, X } from 'lucide-react';
import Link from 'next/link';

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

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Modal states
  const [showDepartmentsModal, setShowDepartmentsModal] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [selectedUserDepts, setSelectedUserDepts] = useState<Department[]>([]);
  const [selectedUserGroups, setSelectedUserGroups] = useState<{group_id: number, group_name: string}[]>([]);
  const [modalUserName, setModalUserName] = useState('');

  // Group assignment modal state
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
    fetchData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [users, searchQuery, roleFilter, departmentFilter]);

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

  const fetchData = async () => {
    try {
      // Fetch users and departments in parallel
      const [usersResponse, departmentsResponse, groupsResponse] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/departments'),
        fetch('/api/groups')
      ]);

      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        const normalizedUsers = (usersData.users || []).map((user: any) => ({
          ...user,
          tags: user.tags || '',
        }));
        setUsers(normalizedUsers);
      }

      if (departmentsResponse.ok) {
        const deptData = await departmentsResponse.json();
        setDepartments(deptData.departments || []);
      }

      if (groupsResponse.ok) {
        const groupData = await groupsResponse.json();
        setGroups(groupData.groups || []);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...users];

    // Search filter (name, username, handle)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(user => {
        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.toLowerCase();
        const username = (user.username || '').toLowerCase();
        const handle = (user.telegram_handle || '').toLowerCase();
        const tags = (user.tags || '').toLowerCase();
        return fullName.includes(query) || username.includes(query) || handle.includes(query) || tags.includes(query);
      });
    }

    // Role filter
    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => user.team_role === roleFilter);
    }

    // Department filter
    if (departmentFilter !== 'all') {
      const deptId = parseInt(departmentFilter);
      filtered = filtered.filter(user => user.department_ids.includes(deptId));
    }

    setFilteredUsers(filtered);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setDepartmentFilter('all');
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

  const openTelegramUser = (username: string | null) => {
    if (username) {
      window.open(`https://t.me/${username}`, '_blank');
    } else {
      // If no username, we can't open their profile directly
      alert('This user does not have a public Telegram username');
    }
  };

  const showUserDepartments = async (user: UserData) => {
    if (user.department_ids.length === 0) return;

    const userDepts = departments.filter(d => user.department_ids.includes(d.department_id));
    setSelectedUserDepts(userDepts);
    setModalUserName(getUserDisplayName(user));
    setShowDepartmentsModal(true);
  };

  const showUserGroups = async (user: UserData) => {
    if (!user.group_connections || user.group_connections.length === 0) return;

    try {
      // Fetch group details
      const response = await fetch('/api/groups');
      if (response.ok) {
        const data: { groups: Group[] } = await response.json();
        const userGroups = data.groups.filter((g) =>
          user.group_connections.includes(g.group_id)
        ).map((g) => ({
          group_id: g.group_id,
          group_name: g.group_name
        }));
        setSelectedUserGroups(userGroups);
        setModalUserName(getUserDisplayName(user));
        setShowGroupsModal(true);
      }
    } catch (error) {
      console.error('Error fetching groups:', error);
    }
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
        // Reset selection after successful save
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
      setUsers((prev) =>
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

  const uniqueRoles = Array.from(new Set(users.map(u => u.team_role).filter(Boolean)));
  const activeFilterCount = [
    searchQuery.trim() ? 1 : 0,
    roleFilter !== 'all' ? 1 : 0,
    departmentFilter !== 'all' ? 1 : 0
  ].reduce((a, b) => a + b, 0);
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
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 bg-neutral-900"></div>
          <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
            User <span className="font-light text-neutral-500">Directory</span>
          </h1>
        </div>
        <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
          {filteredUsers.length} of {users.length} users
          {activeFilterCount > 0 && ` • ${activeFilterCount} filter${activeFilterCount > 1 ? 's' : ''} active`}
        </p>
      </div>

      {/* Search and Filters */}
      <div className="space-y-4">
        {/* Search Bar */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
            <input
              type="text"
              placeholder="Search by name, username, or handle..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 text-sm border rounded-lg flex items-center gap-2 transition-colors ${
              showFilters || activeFilterCount > 0
                ? '!bg-neutral-900 !text-white border-neutral-900'
                : 'bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50'
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="px-1.5 py-0.5 bg-white text-neutral-900 text-xs rounded-full font-medium">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="tech-border bg-neutral-50 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-medium uppercase tracking-wider text-neutral-700">
                Advanced Filters
              </h3>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-neutral-600 hover:text-neutral-900 flex items-center gap-1"
                >
                  <X className="h-3 w-3" />
                  Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Role Filter */}
              <div>
                <label className="block text-[10px] font-medium text-neutral-600 uppercase tracking-wider mb-2">
                  Team Role
                </label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900"
                >
                  <option value="all">All Roles</option>
                  {uniqueRoles.map(role => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>

              {/* Department Filter */}
              <div>
                <label className="block text-[10px] font-medium text-neutral-600 uppercase tracking-wider mb-2">
                  Department
                </label>
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900"
                >
                  <option value="all">All Departments</option>
                  {departments.map(dept => (
                    <option key={dept.department_id} value={dept.department_id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="tech-border bg-white overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
              <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Users...</span>
            </div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-12">
            <User className="h-12 w-12 text-neutral-300 mx-auto mb-3" strokeWidth={1} />
            <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">No users found</p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-xs text-neutral-600 hover:text-neutral-900 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-neutral-100 tech-border-b">
                <tr>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Username
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Departments
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Groups
                  </th>
                  <th className="px-4 py-3 text-left text-[10px] font-medium text-neutral-500 uppercase tracking-wider">
                    Assignments
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredUsers.map((user) => (
                  <tr key={user.user_id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-8 w-8 tech-border bg-white flex items-center justify-center">
                          <User className="h-4 w-4 text-neutral-500" strokeWidth={1} />
                        </div>
                        <div className="ml-3">
                          <Link
                            href={`/dashboard/users/${user.user_id}`}
                            className="text-xs font-medium text-neutral-900 tracking-wide underline hover:text-neutral-600 transition-colors"
                          >
                            {getUserDisplayName(user)}
                          </Link>
                          <div className="text-[10px] text-neutral-500">{user.telegram_handle}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600 font-mono">
                      {user.username ? (
                        <button
                          onClick={() => openTelegramUser(user.username)}
                          className="underline hover:text-neutral-900 transition-colors"
                        >
                          {user.username}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="badge">
                        {user.team_role || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500 font-mono">
                      {user.department_ids.length > 0 ? (
                        <button
                          onClick={() => showUserDepartments(user)}
                          className="underline hover:text-neutral-900 transition-colors"
                        >
                          {user.department_ids.length} dept(s)
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500 font-mono">
                      {user.group_connections?.length > 0 ? (
                        <button
                          onClick={() => showUserGroups(user)}
                          className="underline hover:text-neutral-900 transition-colors"
                        >
                          {user.group_connections.length} group(s)
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-xs">
                      <button
                        onClick={() => openAssignGroupModal(user)}
                        className="tech-button px-3 py-1 text-[11px]"
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Departments Modal */}
      {showDepartmentsModal && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50" onClick={() => setShowDepartmentsModal(false)}>
          <div className="tech-card tech-border bg-white p-6 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold tracking-wider text-neutral-900">{modalUserName}</h3>
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider mt-1">DEPARTMENTS ({selectedUserDepts.length})</p>
              </div>
              <button
                onClick={() => setShowDepartmentsModal(false)}
                className="tech-button p-1"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedUserDepts.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs uppercase tracking-wider text-neutral-500">No departments found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedUserDepts.map((dept) => (
                  <div key={dept.department_id} className="tech-border-b pb-2">
                    <div className="text-sm text-neutral-900 tracking-wide">
                      {dept.name}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      ID: {dept.department_id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Groups Modal */}
      {showGroupsModal && (
        <div className="fixed inset-0 bg-ink/50 flex items-center justify-center z-50" onClick={() => setShowGroupsModal(false)}>
          <div className="tech-card tech-border bg-white p-6 max-w-md w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold tracking-wider text-neutral-900">{modalUserName}</h3>
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider mt-1">GROUPS ({selectedUserGroups.length})</p>
              </div>
              <button
                onClick={() => setShowGroupsModal(false)}
                className="tech-button p-1"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {selectedUserGroups.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-xs uppercase tracking-wider text-neutral-500">No groups found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedUserGroups.map((group) => (
                  <div key={group.group_id} className="tech-border-b pb-2">
                    <div className="text-sm text-neutral-900 tracking-wide">
                      {group.group_name}
                    </div>
                    <div className="text-[10px] text-neutral-500 font-mono">
                      ID: {group.group_id}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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

                {/* Right Column: Existing Assignments (5/12) */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="flex items-center justify-between">
                     <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Active Assignments</h4>
                     <span className="text-[10px] px-2 py-0.5 bg-neutral-100 rounded-full text-neutral-600 font-mono">{assignmentList.length}</span>
                  </div>
                  
                  {assignLoading ? (
                    <div className="flex items-center justify-center py-12 tech-border bg-white rounded-xl">
                      <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
                        Loading...
                      </div>
                    </div>
                  ) : assignmentList.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-neutral-200 rounded-xl bg-neutral-50/50">
                      <p className="text-xs text-neutral-400">No active assignments found.</p>
                      <p className="text-[10px] text-neutral-400 mt-1">Add one using the form.</p>
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col max-h-[calc(100%-40px)]">
                       <div className="overflow-y-auto">
                        <div className="divide-y divide-neutral-100">
                          {assignmentList.map((assignment, idx) => (
                            <div key={`${assignment.group_id}-${assignment.department_id}-${idx}`} className="p-4 hover:bg-neutral-50 transition-colors group">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <div className="font-bold text-sm text-neutral-900">{assignment.group_name}</div>
                                  <div className="text-[10px] text-neutral-500 font-mono">ID: {assignment.group_id} • {assignment.department_name}</div>
                                </div>
                                <button
                                  onClick={() => handleRemoveAssignment(assignment)}
                                  className="text-neutral-400 hover:text-red-600 transition-colors p-1 opacity-0 group-hover:opacity-100"
                                  title="Remove Assignment"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                              
                              <div className="bg-neutral-50 rounded p-2 text-xs border border-neutral-100">
                                <div className="text-[10px] uppercase tracking-wider text-neutral-400 mb-1 font-semibold">Schedule</div>
                                <div className="text-neutral-700 font-medium leading-relaxed">
                                  {summarizeSchedule(Array.isArray(assignment.schedule) ? assignment.schedule as DaySchedule[] : [])}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
