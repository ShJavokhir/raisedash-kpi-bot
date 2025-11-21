'use client';

import { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Users } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Department {
  department_id: number;
  name: string;
  created_at: string;
  updated_at: string;
  metadata: any;
  member_count: number;
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/departments');
      if (response.ok) {
        const data = await response.json();
        setDepartments(data.departments);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);

    try {
      const response = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDepartmentName }),
      });

      if (response.ok) {
        setShowCreateModal(false);
        setNewDepartmentName('');
        fetchDepartments();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to create department');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteDepartment = async (departmentId: number) => {
    if (!confirm('Are you sure you want to delete this department?')) return;

    try {
      const response = await fetch(`/api/departments/${departmentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchDepartments();
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to delete department');
      }
    } catch (error) {
      alert('An error occurred');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b-2 border-neutral-800 pb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 bg-neutral-900"></div>
            <h1 className="text-xl font-bold tracking-widest uppercase text-ink">
              Department <span className="font-light text-neutral-500">Management</span>
            </h1>
          </div>
          <p className="text-[10px] text-neutral-500 pl-4 uppercase tracking-wider">
            Organizational structure and member assignments
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="tech-button flex items-center gap-2 no-print"
        >
          <Plus className="h-3 w-3" strokeWidth={1} />
          New Department
        </button>
      </div>

      {/* Departments grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
            <span className="text-xs uppercase tracking-wider text-neutral-500">Loading Departments...</span>
          </div>
        </div>
      ) : departments.length === 0 ? (
        <div className="tech-border bg-white p-12 text-center">
          <p className="text-xs uppercase tracking-wider text-neutral-500 mb-4">No departments found</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="tech-button"
          >
            Create First Department
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {departments.map((department) => (
            <div
              key={department.department_id}
              className="tech-border bg-white p-4 tech-card"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-sm font-bold tracking-wider text-neutral-900 mb-1">{department.name}</h3>
                  <p className="text-[10px] text-neutral-500 uppercase tracking-wide font-mono">
                    Created {formatDate(department.created_at)}
                  </p>
                </div>
                <button
                  onClick={() => handleDeleteDepartment(department.department_id)}
                  className="p-1 text-neutral-400 hover:text-neutral-900 transition-colors"
                  title="Delete department"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1} />
                </button>
              </div>
              <div className="pt-3 tech-border-t space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">Members</span>
                  <span className="text-xs text-neutral-900 font-mono font-bold">{department.member_count || 0}</span>
                </div>
                <a
                  href={`/dashboard/departments/${department.department_id}`}
                  className="tech-button w-full flex items-center justify-center gap-2 hover:!bg-neutral-900 hover:!text-white transition-colors"
                >
                  <Users className="h-3 w-3" strokeWidth={1} />
                  <span className="text-[10px] uppercase tracking-wider font-bold">Manage Members</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create department modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-neutral-900 bg-opacity-50 flex items-center justify-center z-50">
          <div className="tech-border bg-white p-6 max-w-md w-full m-4">
            <div className="section-header mb-6">
              <div className="section-tag">New Department</div>
            </div>
            <form onSubmit={handleCreateDepartment}>
              <div className="mb-6">
                <label htmlFor="department-name" className="block text-[10px] uppercase tracking-wider text-neutral-500 mb-2 font-semibold">
                  Department Name
                </label>
                <input
                  id="department-name"
                  type="text"
                  required
                  value={newDepartmentName}
                  onChange={(e) => setNewDepartmentName(e.target.value)}
                  className="tech-input w-full"
                  placeholder="OPERATIONS, SUPPORT, ETC."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewDepartmentName('');
                  }}
                  className="tech-button"
                  disabled={creating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="tech-button bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
