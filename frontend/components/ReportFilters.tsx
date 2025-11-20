'use client';

import { useState, useEffect } from 'react';

export interface ReportFiltersState {
  departmentIds: string[];
  userIds: string[];
  groupIds: string[];
  statuses: string[];
}

interface ReportFiltersProps {
  value: ReportFiltersState;
  onChange: (filters: ReportFiltersState) => void;
  availableDepartments?: { department_id: number; name: string }[];
  availableUsers?: { user_id: number; username: string | null; first_name: string | null; last_name: string | null }[];
  availableGroups?: { group_id: number; group_name: string }[];
  showDepartments?: boolean;
  showUsers?: boolean;
  showGroups?: boolean;
  showStatuses?: boolean;
}

const INCIDENT_STATUSES = [
  'Awaiting_Department',
  'Awaiting_Claim',
  'In_Progress',
  'Awaiting_Summary',
  'Resolved',
  'Closed',
];

export default function ReportFilters({
  value,
  onChange,
  availableDepartments = [],
  availableUsers = [],
  availableGroups = [],
  showDepartments = true,
  showUsers = true,
  showGroups = true,
  showStatuses = true,
}: ReportFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Format user display name
  const getUserDisplayName = (user: { username: string | null; first_name: string | null; last_name: string | null }) => {
    if (user.first_name || user.last_name) {
      return `${user.first_name || ''} ${user.last_name || ''}`.trim();
    }
    return user.username || 'Unknown User';
  };

  // Handle multi-select change
  const handleMultiSelectChange = (key: keyof ReportFiltersState, selectedValue: string) => {
    const currentValues = value[key] as string[];
    const isSelected = currentValues.includes(selectedValue);

    const newValues = isSelected
      ? currentValues.filter((v) => v !== selectedValue)
      : [...currentValues, selectedValue];

    onChange({
      ...value,
      [key]: newValues,
    });
  };

  // Clear all filters
  const handleClearAll = () => {
    onChange({
      departmentIds: [],
      userIds: [],
      groupIds: [],
      statuses: [],
    });
  };

  // Check if any filters are applied
  const hasActiveFilters =
    value.departmentIds.length > 0 ||
    value.userIds.length > 0 ||
    value.groupIds.length > 0 ||
    value.statuses.length > 0;

  const activeFiltersCount =
    value.departmentIds.length +
    value.userIds.length +
    value.groupIds.length +
    value.statuses.length;

  return (
    <div className="tech-border bg-white p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-neutral-900 hover:text-neutral-600 transition-colors"
        >
          <span className="section-tag">Filters</span>
          {hasActiveFilters && (
            <span className="px-2 py-0.5 tech-border text-xs font-mono">
              {activeFiltersCount} active
            </span>
          )}
          <span className="text-xs">{isExpanded ? '▼' : '▶'}</span>
        </button>

        {hasActiveFilters && (
          <button
            onClick={handleClearAll}
            className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Expanded Filters */}
      {isExpanded && (
        <div className="space-y-4 pt-3 tech-border-t">
          {/* Department Filter */}
          {showDepartments && availableDepartments.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                Departments ({value.departmentIds.length} selected)
              </label>
              <div className="max-h-40 overflow-y-auto tech-border p-2 space-y-1">
                {availableDepartments.map((dept) => (
                  <label key={dept.department_id} className="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 p-1">
                    <input
                      type="checkbox"
                      checked={value.departmentIds.includes(String(dept.department_id))}
                      onChange={() => handleMultiSelectChange('departmentIds', String(dept.department_id))}
                      className="w-4 h-4"
                    />
                    <span className="text-xs font-mono text-neutral-900">{dept.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* User Filter */}
          {showUsers && availableUsers.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                Users ({value.userIds.length} selected)
              </label>
              <div className="max-h-40 overflow-y-auto tech-border p-2 space-y-1">
                {availableUsers.map((user) => (
                  <label key={user.user_id} className="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 p-1">
                    <input
                      type="checkbox"
                      checked={value.userIds.includes(String(user.user_id))}
                      onChange={() => handleMultiSelectChange('userIds', String(user.user_id))}
                      className="w-4 h-4"
                    />
                    <span className="text-xs font-mono text-neutral-900">{getUserDisplayName(user)}</span>
                    {user.username && (
                      <span className="text-[10px] text-neutral-500">@{user.username}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Group Filter */}
          {showGroups && availableGroups.length > 0 && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                Groups ({value.groupIds.length} selected)
              </label>
              <div className="max-h-40 overflow-y-auto tech-border p-2 space-y-1">
                {availableGroups.map((group) => (
                  <label key={group.group_id} className="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 p-1">
                    <input
                      type="checkbox"
                      checked={value.groupIds.includes(String(group.group_id))}
                      onChange={() => handleMultiSelectChange('groupIds', String(group.group_id))}
                      className="w-4 h-4"
                    />
                    <span className="text-xs font-mono text-neutral-900">{group.group_name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Status Filter */}
          {showStatuses && (
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                Status ({value.statuses.length} selected)
              </label>
              <div className="tech-border p-2 space-y-1">
                {INCIDENT_STATUSES.map((status) => (
                  <label key={status} className="flex items-center gap-2 cursor-pointer hover:bg-neutral-50 p-1">
                    <input
                      type="checkbox"
                      checked={value.statuses.includes(status)}
                      onChange={() => handleMultiSelectChange('statuses', status)}
                      className="w-4 h-4"
                    />
                    <span className="text-xs font-mono text-neutral-900">{status.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
