'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  Building2,
  MessageSquare,
  AlertCircle,
  BarChart3,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

interface SessionData {
  companyId: number;
  companyName: string;
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetchSession();
  }, []);

  const fetchSession = async () => {
    try {
      const response = await fetch('/api/auth/session');
      if (response.ok) {
        const data = await response.json();
        setSession(data);
      } else {
        router.push('/login');
      }
    } catch (error) {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const navigation = [
    {
      name: 'Overview',
      href: '/dashboard',
      icon: LayoutDashboard,
    },
    {
      name: 'Incidents',
      href: '/dashboard/incidents',
      icon: AlertCircle,
    },
    {
      name: 'Departments',
      href: '/dashboard/departments',
      icon: Building2,
    },
    {
      name: 'Users',
      href: '/dashboard/users',
      icon: Users,
    },
    {
      name: 'Groups',
      href: '/dashboard/groups',
      icon: MessageSquare,
    },
    {
      name: 'Reports',
      href: '/dashboard/reports',
      icon: BarChart3,
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-noise">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-neutral-900 animate-pulse-subtle"></div>
          <span className="text-xs uppercase tracking-wider text-neutral-500">Initializing...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-noise">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-neutral-900 bg-opacity-50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 bg-white tech-border-r transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-6 border-b-2 border-neutral-800">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-neutral-900"></div>
              <h1 className="text-sm font-bold tracking-widest uppercase text-ink">
                Raisedash <span className="font-light text-neutral-500">KPI</span>
              </h1>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              <X className="h-4 w-4" strokeWidth={1} />
            </button>
          </div>

          {/* Company info */}
          <div className="px-6 py-4 tech-border-b bg-neutral-50">
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest mb-1">
              Company
            </p>
            <p className="text-xs font-medium text-neutral-900 uppercase tracking-wide">
              {session?.companyName}
            </p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto custom-scrollbar">
            {navigation.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
                    isActive
                      ? 'bg-neutral-900 text-white'
                      : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                  }`}
                >
                  <item.icon className={`mr-3 h-4 w-4 ${isActive ? 'text-white' : 'text-neutral-400'}`} strokeWidth={1} />
                  {item.name}
                </Link>
              );
            })}
          </nav>

          {/* Logout button */}
          <div className="p-4 tech-border-t">
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
            >
              <LogOut className="mr-3 h-4 w-4 text-neutral-400" strokeWidth={1} />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="h-16 bg-white tech-border-b flex items-center px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-neutral-500 hover:text-neutral-900 mr-4 transition-colors"
          >
            <Menu className="h-5 w-5" strokeWidth={1} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-neutral-900"></div>
            <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-bold">
              System Dashboard
            </span>
          </div>
          <div className="flex-1" />
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">
            {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
