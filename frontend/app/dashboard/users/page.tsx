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

export default function UsersPage() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserData[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
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

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [users, searchQuery, roleFilter, departmentFilter]);

  const fetchData = async () => {
    try {
      // Fetch users and departments in parallel
      const [usersResponse, departmentsResponse] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/departments')
      ]);

      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData.users);
      }

      if (departmentsResponse.ok) {
        const deptData = await departmentsResponse.json();
        setDepartments(deptData.departments || []);
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

  const openTelegramUser = (username: string | null, userId: number) => {
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
        const data = await response.json();
        const userGroups = data.groups.filter((g: any) =>
          user.group_connections.includes(g.group_id)
        ).map((g: any) => ({
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

  const uniqueRoles = Array.from(new Set(users.map(u => u.team_role).filter(Boolean)));
  const activeFilterCount = [
    searchQuery.trim() ? 1 : 0,
    roleFilter !== 'all' ? 1 : 0,
    departmentFilter !== 'all' ? 1 : 0
  ].reduce((a, b) => a + b, 0);

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
              className="w-full pl-10 pr-4 py-2 text-sm border border-neutral-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 py-2 text-sm border rounded-lg flex items-center gap-2 transition-colors ${
              showFilters || activeFilterCount > 0
                ? 'bg-neutral-900 text-white border-neutral-900'
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
                            className="text-xs font-medium text-neutral-900 uppercase tracking-wide underline hover:text-neutral-600 transition-colors"
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
                          onClick={() => openTelegramUser(user.username, user.user_id)}
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
                <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900">{modalUserName}</h3>
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
                    <div className="text-sm text-neutral-900 uppercase tracking-wide">
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
                <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-900">{modalUserName}</h3>
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
                    <div className="text-sm text-neutral-900 uppercase tracking-wide">
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
    </div>
  );
}
