'use client';

import { useEffect, useMemo, useState } from 'react';
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
  manager_user_id: number | null;
  manager_label: string | null;
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
  const [managerSearch, setManagerSearch] = useState('');
  const [managerSelection, setManagerSelection] = useState<number | null>(null);
  const [managerLabelInput, setManagerLabelInput] = useState('');
  const [managerMode, setManagerMode] = useState<'none' | 'user' | 'label'>('none');
  const [savingManager, setSavingManager] = useState(false);
  const [managerError, setManagerError] = useState<string | null>(null);
  const [managerFeedback, setManagerFeedback] = useState<string | null>(null);
  const [showManagerPanel, setShowManagerPanel] = useState(false);

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
      setManagerSearch('');
      setManagerSelection(assignUser.manager_user_id ?? null);
      setManagerLabelInput(assignUser.manager_label || '');
      setManagerMode(
        assignUser.manager_user_id ? 'user' : assignUser.manager_label ? 'label' : 'none'
      );
      setManagerFeedback(null);
      setManagerError(null);
      setShowManagerPanel(false);
    } else {
      setTagInput('');
      setTagFeedback(null);
      setTagError(null);
      setManagerSearch('');
      setManagerSelection(null);
      setManagerLabelInput('');
      setManagerMode('none');
      setManagerFeedback(null);
      setManagerError(null);
      setShowManagerPanel(false);
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
          manager_user_id: user.manager_user_id ?? null,
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

  const defaultScheduleTemplate = useMemo(() => {
    const template = {} as Record<DayName, DaySchedule>;
    DAY_ORDER.forEach((day) => {
      template[day] = { day, enabled: true, start_time: '07:00', end_time: '19:00' };
    });
    return template;
  }, []);

  const normalizeScheduleFromAssignment = (source: GroupAssignment['schedule']): DaySchedule[] => {
    const normalized = new Map<DayName, DaySchedule>();

    if (Array.isArray(source)) {
      source.forEach((entry) => {
        const dayKey = (entry.day || '').toString().toLowerCase() as DayName;
        if (!DAY_ORDER.includes(dayKey)) return;

        const defaults = defaultScheduleTemplate[dayKey];
        const startMinutes = parseHHMM(entry.start_time);
        const endMinutes = parseHHMM(entry.end_time);
        const timesValid = startMinutes !== null && endMinutes !== null && startMinutes !== endMinutes;

        normalized.set(dayKey, {
          day: dayKey,
          enabled: Boolean(entry.enabled),
          start_time: entry.enabled && timesValid ? entry.start_time : defaults.start_time,
          end_time: entry.enabled && timesValid ? entry.end_time : defaults.end_time,
        });
      });
    }

    return DAY_ORDER.map((day) => {
      const saved = normalized.get(day);
      if (saved) return saved;
      const defaults = defaultScheduleTemplate[day];
      return { ...defaults, enabled: false };
    });
  };

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

  const getManagerLabel = (managerId: number | null, managerLabel?: string | null) => {
    if (managerLabel) return managerLabel;
    if (!managerId) return '—';
    const manager = users.find((u) => u.user_id === managerId);
    return manager ? getUserDisplayName(manager) : `User ${managerId}`;
  };

  const HierarchyNode = ({
    node,
    isLast,
    depth,
  }: {
    node: ManagerTreeNode;
    isLast: boolean;
    depth: number;
  }) => {
    const hasChildren = node.children.length > 0;
    const isLabel = node.user.manager_label === node.user.first_name && node.user.user_id === -1;
    const displayName = isLabel ? node.user.manager_label || node.user.first_name : getUserDisplayName(node.user);
    const idLabel = isLabel ? 'Label' : `ID:${node.user.user_id}`;
    return (
      <div className="relative">
        {depth > 0 && (
          <div
            className={`absolute left-2 top-0 ${isLast ? 'h-3' : 'h-full'} border-l border-neutral-200`}
            aria-hidden
          />
        )}
        <div className="relative pl-6">
          {depth > 0 && (
            <div className="absolute left-2 top-3 w-4 border-t border-neutral-200" aria-hidden />
          )}
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${isLabel ? 'bg-amber-500' : 'bg-neutral-900'}`} />
              <div>
                <div className="text-xs font-semibold text-neutral-900">{displayName}</div>
                <div className="text-[10px] text-neutral-500 font-mono flex items-center gap-1">
                  <span>{idLabel}</span>
                  {!isLabel && node.user.username && <span>• @{node.user.username}</span>}
                </div>
              </div>
            </div>
            {hasChildren && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-neutral-50 text-neutral-600 border border-neutral-200">
                {node.children.length} report{node.children.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {hasChildren && (
            <div className="mt-2 pl-4 relative">
              <div className="absolute left-1 top-0 bottom-0 border-l border-neutral-100" aria-hidden />
              <div className="space-y-2">
                {node.children.map((child, idx) => (
                  <HierarchyNode
                    key={`${displayName}-${idx}`}
                    node={child}
                    isLast={idx === node.children.length - 1}
                    depth={depth + 1}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
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

  const handleSaveManager = async (override?: { mode?: 'none' | 'user' | 'label'; selection?: number | null; label?: string }) => {
    if (!assignUser) return;
    setSavingManager(true);
    setManagerError(null);
    setManagerFeedback(null);

    try {
      const effectiveMode = override?.mode ?? managerMode;
      const effectiveSelection = override?.selection ?? managerSelection;
      const effectiveLabel = override?.label ?? managerLabelInput;
      let body: any = {};
      if (effectiveMode === 'user') {
        body.manager_user_id = effectiveSelection ?? null;
        body.manager_label = null;
        if (effectiveSelection === null) {
          setSavingManager(false);
          setManagerError('Select a manager user before saving, or switch to label/none.');
          return;
        }
      } else if (effectiveMode === 'label') {
        const normalized = (effectiveLabel || '').trim();
        if (!normalized) {
          setSavingManager(false);
          setManagerError('Provide a label name.');
          return;
        }
        body.manager_label = normalized;
        body.manager_user_id = null;
      } else {
        body.manager_user_id = null;
        body.manager_label = null;
      }

      const response = await fetch(`/api/users/${assignUser.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        setManagerError(data.error || 'Failed to update manager');
        return;
      }

      const data = await response.json();
      setManagerFeedback('Manager updated');
      setUsers((prev) =>
        prev.map((u) =>
          u.user_id === assignUser.user_id
            ? {
                ...u,
                manager_user_id: data.manager_user_id ?? null,
                manager_label: data.manager_label ?? null,
              }
            : u
        )
      );
      setAssignUser((prev) =>
        prev
          ? {
              ...prev,
              manager_user_id: data.manager_user_id ?? null,
              manager_label: data.manager_label ?? null,
            }
          : prev
      );
      setManagerSelection(data.manager_user_id ?? null);
      setManagerLabelInput(data.manager_label ?? '');
      setManagerMode(data.manager_label ? 'label' : data.manager_user_id ? 'user' : 'none');
    } catch (error) {
      console.error('Error updating manager:', error);
      setManagerError('Failed to update manager');
    } finally {
      setSavingManager(false);
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
  const managerOptions = users
    .filter((u) => !assignUser || u.user_id !== assignUser.user_id)
    .filter((u) => {
      if (!managerSearch.trim()) return true;
      const query = managerSearch.toLowerCase();
      const name = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      const username = (u.username || '').toLowerCase();
      const handle = (u.telegram_handle || '').toLowerCase();
      return name.includes(query) || username.includes(query) || handle.includes(query) || String(u.user_id).includes(query);
    })
    .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || ''));
  const currentManager = assignUser && assignUser.manager_user_id
    ? users.find((u) => u.user_id === assignUser.manager_user_id)
    : null;
  type ManagerTreeNode = { user: UserData; children: ManagerTreeNode[] };

  const latestAssignment = useMemo(() => {
    if (!assignUser) return null;
    const assignments = groupAssignments[assignUser.user_id] || [];
    if (assignments.length === 0) return null;

    let newest: GroupAssignment | null = null;
    let newestTime = -Infinity;
    assignments.forEach((assignment) => {
      const ts = Date.parse(assignment.added_at);
      if (!Number.isNaN(ts) && ts > newestTime) {
        newest = assignment;
        newestTime = ts;
      }
    });

    return newest || assignments[0];
  }, [assignUser, groupAssignments]);

  const copyLatestSchedule = () => {
    if (!latestAssignment) return;
    const normalizedSchedule = normalizeScheduleFromAssignment(latestAssignment.schedule);
    setSchedule(normalizedSchedule);
    setAssignError(null);
  };

  const managerForest = useMemo<ManagerTreeNode[]>(() => {
    const childrenMap = new Map<string, UserData[]>();
    users.forEach((u) => {
      if (u.manager_user_id) {
        const key = `u:${u.manager_user_id}`;
        if (!childrenMap.has(key)) {
          childrenMap.set(key, []);
        }
        childrenMap.get(key)!.push(u);
      } else if (u.manager_label) {
        const key = `l:${u.manager_label.trim()}`;
        if (!childrenMap.has(key)) {
          childrenMap.set(key, []);
        }
        childrenMap.get(key)!.push(u);
      }
    });

    // Sort children for deterministic rendering
    childrenMap.forEach((list, key) => {
      list.sort((a, b) => getUserDisplayName(a).localeCompare(getUserDisplayName(b)));
      childrenMap.set(key, list);
    });

    const childKeys = new Set<string>();
    childrenMap.forEach((list, parentKey) => {
      list.forEach((child) => childKeys.add(`u:${child.user_id}`));
    });

    const rootKeys = Array.from(childrenMap.keys()).filter((key) => !childKeys.has(key));

    const build = (key: string, visited: Set<string>): ManagerTreeNode | null => {
      if (visited.has(key)) return null;
      const nextVisited = new Set(visited);
      nextVisited.add(key);

      if (key.startsWith('l:')) {
        const label = key.slice(2);
        const children = (childrenMap.get(key) || [])
          .map((child) => build(`u:${child.user_id}`, nextVisited))
          .filter(Boolean) as ManagerTreeNode[];
        return { user: { user_id: -1, username: '', first_name: label, last_name: '', telegram_handle: '', team_role: 'Label', department_ids: [], group_connections: [], manager_user_id: null, manager_label: label, tags: '', created_at: '' }, children };
      }

      const userId = Number(key.slice(2));
      const user = users.find((u) => u.user_id === userId);
      if (!user) return null;
      const children = (childrenMap.get(key) || [])
        .map((child) => build(`u:${child.user_id}`, nextVisited))
        .filter(Boolean) as ManagerTreeNode[];
      return { user, children };
    };

    return rootKeys
      .map((rootKey) => build(rootKey, new Set()))
      .filter(Boolean) as ManagerTreeNode[];
  }, [users, getUserDisplayName]);

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

      {/* Manager Hierarchy */}
      <div className="tech-border bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-neutral-900 rounded-full"></div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700">Manager Hierarchy</h3>
          </div>
          <span className="text-[10px] text-neutral-500">Roots: {managerForest.length}</span>
        </div>
        {managerForest.length === 0 ? (
          <p className="text-xs text-neutral-500 italic">No hierarchy available.</p>
        ) : (
          <div className="space-y-3">
            {managerForest.map((node, idx) => (
              <HierarchyNode key={`root-${node.user.user_id}-${idx}`} node={node} isLast={idx === managerForest.length - 1} depth={0} />
            ))}
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
                    Manager
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
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600">
                      {getManagerLabel(user.manager_user_id, user.manager_label)}
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
                  {/* Manager selection */}
                  <div className="bg-white p-5 rounded-xl border border-neutral-200 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 bg-neutral-900 rounded-full"></div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-900">Manager</h4>
                      </div>
                      {managerFeedback && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200">
                          Saved
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-neutral-700">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Current:</span>
                        <span className="font-mono text-neutral-800">
                          {currentManager ? getUserDisplayName(currentManager) : 'No manager'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowManagerPanel((prev) => !prev)}
                        className="tech-button px-3 py-1 text-[11px]"
                      >
                        {showManagerPanel ? 'Close' : 'Manage Manager'}
                      </button>
                    </div>
                    {managerError && (
                      <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
                        {managerError}
                      </div>
                    )}
                    {showManagerPanel && (
                      <div className="space-y-3 border-t border-neutral-100 pt-3">
                        <p className="text-[10px] text-neutral-500 leading-relaxed">
                          Choose between a user manager or a label (e.g., GROUP1) for reporting.
                        </p>
                        <div className="flex gap-2 flex-wrap text-[11px]">
                          <button
                            type="button"
                            onClick={() => setManagerMode('user')}
                            className={`px-3 py-1 rounded-full border ${managerMode === 'user' ? '!bg-neutral-900 !text-white border-neutral-900' : 'border-neutral-200 text-neutral-700'}`}
                          >
                            User manager
                          </button>
                          <button
                            type="button"
                            onClick={() => setManagerMode('label')}
                            className={`px-3 py-1 rounded-full border ${managerMode === 'label' ? '!bg-neutral-900 !text-white border-neutral-900' : 'border-neutral-200 text-neutral-700'}`}
                          >
                            Label manager
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setManagerMode('none');
                              setManagerSelection(null);
                              setManagerLabelInput('');
                            }}
                            className={`px-3 py-1 rounded-full border ${managerMode === 'none' ? '!bg-neutral-900 !text-white border-neutral-900' : 'border-neutral-200 text-neutral-700'}`}
                          >
                            None
                          </button>
                        </div>
                        <div className="relative">
                          {managerMode === 'user' ? (
                            <>
                              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-400" strokeWidth={1} />
                              <input
                                type="text"
                                value={managerSearch}
                                onChange={(e) => setManagerSearch(e.target.value)}
                                placeholder="Search by name, username, handle or ID..."
                                className="tech-input w-full pl-10"
                              />
                            </>
                          ) : managerMode === 'label' ? (
                            <input
                              type="text"
                              value={managerLabelInput}
                              onChange={(e) => setManagerLabelInput(e.target.value)}
                              placeholder="Label e.g., GROUP1"
                              className="tech-input w-full"
                            />
                          ) : (
                            <div className="text-[11px] text-neutral-500">No manager will be set.</div>
                          )}
                        </div>
                        {managerMode === 'user' && (
                          <div className="border border-neutral-200 rounded-lg bg-white h-40 overflow-y-auto custom-scrollbar">
                            {managerOptions.length === 0 ? (
                              <div className="p-3 text-[11px] text-neutral-500 text-center">No matching users</div>
                            ) : (
                              <div className="divide-y divide-neutral-100">
                                {managerOptions.map((user) => {
                                  const selected = managerSelection === user.user_id;
                                  return (
                                    <button
                                      key={user.user_id}
                                      type="button"
                                      onClick={() => setManagerSelection(user.user_id)}
                                      className={`w-full flex items-center justify-between p-3 text-left transition-colors ${
                                        selected ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50'
                                      }`}
                                      disabled={savingManager}
                                    >
                                      <div>
                                        <div className="text-sm font-semibold">{getUserDisplayName(user)}</div>
                                        <div className={`text-[10px] font-mono ${selected ? 'text-neutral-200' : 'text-neutral-400'}`}>
                                          ID: {user.user_id} {user.username ? `• @${user.username}` : ''}
                                        </div>
                                      </div>
                                      {selected && (
                                        <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full uppercase">Selected</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveManager()}
                            className="tech-button px-3 py-2 text-[11px] !bg-neutral-900 !text-white hover:!bg-neutral-800 disabled:opacity-50"
                            disabled={savingManager}
                          >
                            {savingManager ? 'Saving...' : 'Save Manager'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleSaveManager({ mode: 'none', selection: null, label: '' });
                            }}
                            className="tech-button px-3 py-2 text-[11px] bg-neutral-100 text-neutral-700 hover:bg-neutral-200 disabled:opacity-50"
                            disabled={savingManager}
                          >
                            Clear Manager
                          </button>
                          <span className="text-[10px] text-neutral-500">Leaves user as a root node.</span>
                        </div>
                      </div>
                    )}
                  </div>

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
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                          <label className="block text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                            3. Availability Schedule
                          </label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={copyLatestSchedule}
                              disabled={!latestAssignment || assignLoading}
                              className="text-[11px] px-3 py-1 rounded-lg border border-neutral-200 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Copy last shift details
                            </button>
                            <span className="text-[10px] text-neutral-500">
                              {latestAssignment
                                ? `From ${latestAssignment.group_name} • ${latestAssignment.department_name}`
                                : 'No previous assignment to copy'}
                            </span>
                          </div>
                        </div>
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
