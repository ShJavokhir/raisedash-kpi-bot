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
  shift: 'DAY' | 'NIGHT';
  added_at: string;
}

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
  const [selectedShifts, setSelectedShifts] = useState<Array<'DAY' | 'NIGHT'>>(['DAY']);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [users, searchQuery, roleFilter, departmentFilter]);

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
        setUsers(usersData.users);
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
        return fullName.includes(query) || username.includes(query) || handle.includes(query);
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
    setSelectedShifts(['DAY']);
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
    setSelectedShifts(['DAY']);
  };

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId)
        ? prev.filter((id) => id !== groupId)
        : [...prev, groupId]
    );
  };

  const toggleShift = (shift: 'DAY' | 'NIGHT') => {
    setSelectedShifts((prev) =>
      prev.includes(shift)
        ? prev.filter((s) => s !== shift)
        : [...prev, shift]
    );
  };

  const handleAddGroupAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignUser || selectedGroupIds.length === 0 || !selectedDepartmentId || selectedShifts.length === 0) return;

    setSavingAssignment(true);
    setAssignError(null);
    try {
      const payloads = selectedGroupIds.flatMap((groupId) =>
        selectedShifts.map((shift) => ({
          group_id: parseInt(groupId),
          shift,
        }))
      );

      const errors: string[] = [];
      for (const payload of payloads) {
        const response = await fetch('/api/group-members', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: assignUser.user_id,
            group_id: payload.group_id,
            department_id: parseInt(selectedDepartmentId),
            shift: payload.shift,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          errors.push(data.error || `Failed for group ${payload.group_id} (${payload.shift})`);
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
      shift: assignment.shift,
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
            className="tech-card tech-border bg-white p-6 max-w-5xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold tracking-wider text-neutral-900">{getUserDisplayName(assignUser)}</h3>
                <p className="text-[10px] text-neutral-500 uppercase tracking-wider mt-1">
                  Group Assignments ({assignmentList.length})
                </p>
              </div>
              <button
                onClick={closeAssignGroupModal}
                className="tech-button p-1"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {assignError && (
              <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">
                {assignError}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Assignment form */}
              <form onSubmit={handleAddGroupAssignment} className="space-y-4">
                <div className="section-tag mb-3">Add Assignment</div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                      Department (must match membership)
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

                  <div>
                    <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                      Shifts (choose one or both)
                    </label>
                    <div className="flex gap-3">
                      {(['DAY', 'NIGHT'] as Array<'DAY' | 'NIGHT'>).map((shift) => {
                        const active = selectedShifts.includes(shift);
                        return (
                          <label key={shift} className={`flex items-center gap-2 px-3 py-2 tech-border cursor-pointer ${
                            active ? '!bg-neutral-900 !text-white' : 'bg-white'
                          }`}>
                            <input
                              type="checkbox"
                              name="shift"
                              value={shift}
                              checked={active}
                              onChange={() => toggleShift(shift)}
                            />
                            <span className="text-xs font-semibold">{shift}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                    Search Groups
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
                    <input
                      type="text"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Name or ID..."
                      className="tech-input w-full pl-10"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                    Select Groups ({filteredGroupOptions.length} available)
                  </label>
                  <div className="tech-border bg-white max-h-64 overflow-y-auto custom-scrollbar">
                    {filteredGroupOptions.length === 0 ? (
                      <div className="p-4 text-xs text-neutral-500">No matching groups</div>
                    ) : (
                      <div className="divide-y divide-neutral-200">
                        {filteredGroupOptions.map((group) => {
                          const active = selectedGroupIds.includes(String(group.group_id));
                          return (
                            <label
                              key={group.group_id}
                              className={`flex items-center justify-between p-3 cursor-pointer ${
                                active ? '!bg-neutral-900 !text-white' : 'hover:bg-neutral-50'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  name="group"
                                  value={group.group_id}
                                  checked={active}
                                  onChange={() => toggleGroupSelection(String(group.group_id))}
                                  className="h-4 w-4"
                                />
                                <div>
                                  <div className={`text-sm font-semibold ${active ? '!text-white' : 'text-neutral-900'}`}>
                                    {group.group_name}
                                  </div>
                                  <div className={`text-[10px] font-mono ${active ? '!text-neutral-200' : 'text-neutral-500'}`}>
                                    ID: {group.group_id}
                                  </div>
                                </div>
                              </div>
                              <span className="badge">{group.status}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 tech-border-t">
                  <button
                  type="button"
                  className="tech-button"
                  onClick={closeAssignGroupModal}
                  disabled={savingAssignment}
                >
                  Cancel
                </button>
                  <button
                    type="submit"
                    className="tech-button !bg-neutral-900 !text-white hover:!bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      savingAssignment ||
                      selectedGroupIds.length === 0 ||
                      !selectedDepartmentId ||
                      selectedShifts.length === 0 ||
                      userDepartments.length === 0
                    }
                  >
                    {savingAssignment ? 'Saving...' : 'Add Assignment'}
                  </button>
                </div>
              </form>

              {/* Existing assignments */}
              <div className="space-y-3">
                <div className="section-tag">Active Assignments</div>
                {assignLoading ? (
                  <div className="flex items-center gap-2 text-xs text-neutral-500">
                    <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
                    Loading assignments...
                  </div>
                ) : assignmentList.length === 0 ? (
                  <div className="tech-border bg-neutral-50 p-6 text-xs text-neutral-500">
                    No assignments yet.
                  </div>
                ) : (
                  <div className="tech-border bg-white overflow-hidden">
                    <div className="max-h-80 overflow-y-auto">
                      <table className="min-w-full">
                        <thead className="bg-neutral-100 tech-border-b">
                          <tr>
                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-500">Group</th>
                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-500">Department</th>
                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-500">Shift</th>
                            <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-neutral-500">Added</th>
                            <th className="px-3 py-2"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-200">
                          {assignmentList.map((assignment) => (
                            <tr key={`${assignment.group_id}-${assignment.department_id}-${assignment.shift}`}>
                              <td className="px-3 py-2 text-xs text-neutral-900">
                                <div className="font-semibold">{assignment.group_name}</div>
                                <div className="text-[10px] text-neutral-500 font-mono">ID: {assignment.group_id}</div>
                              </td>
                              <td className="px-3 py-2 text-xs text-neutral-900">
                                {assignment.department_name}
                              </td>
                              <td className="px-3 py-2 text-xs">
                                <span className="badge">{assignment.shift}</span>
                              </td>
                              <td className="px-3 py-2 text-[10px] text-neutral-500 font-mono">
                                {new Date(assignment.added_at).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  onClick={() => handleRemoveAssignment(assignment)}
                                  className="p-1 text-neutral-400 hover:text-neutral-900 transition-colors"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
