import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdminSidebar } from '../navigation/AdminSidebar';
import { useAuth } from '../../lib/authContext';
import { EnvNoticeBanner } from '../ui/EnvNoticeBanner';
import { ShieldAlert, ArrowLeft, Lock, LogIn, LogOut } from 'lucide-react';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export const AdminLayout: React.FC<AdminLayoutProps> = ({ children }) => {
  const { user, profile, isAdmin, loading, toggleDevRole, signOut } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-300 font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm font-medium">Verifying Administrator Authorization...</p>
        </div>
      </div>
    );
  }

  // Case 1: Visitor is not authenticated -> Prompt to sign in
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
        <EnvNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center shadow-2xl space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Lock className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Authentication Required</h2>
              <p className="text-sm text-slate-400 leading-relaxed">
                You must sign in with an authorized administrator account to access the operations console.
              </p>
            </div>
            <div className="space-y-3 pt-2">
              <Link
                to="/login"
                className="w-full py-3 px-4 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4 text-[#C89B3C]" />
                Sign In to Operations
              </Link>
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Return to Customer Homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 2: Authenticated user is not an administrator -> Show explicit Access Denied
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
        <EnvNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-rose-900/40 rounded-2xl p-8 text-center shadow-2xl space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-white">Access Denied</h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                You don't have permission to access the administration area.
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                The operations console is strictly restricted to administrator accounts (<code className="text-amber-400">role: 'admin'</code>).
              </p>
            </div>
            <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs text-left space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Account:</span>
                <span className="font-medium text-white truncate max-w-[200px]">{user.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Assigned Role:</span>
                <span className="font-bold text-rose-400 uppercase tracking-wide">{profile?.role || 'customer'}</span>
              </div>
            </div>
            <div className="space-y-3 pt-2">
              {import.meta.env.DEV && (
                <button
                  onClick={() => toggleDevRole('admin')}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs border border-amber-500/30 transition-all flex items-center justify-center gap-2"
                >
                  <ShieldAlert className="w-4 h-4 text-amber-400" />
                  [Dev Only] Switch to Admin Role
                </button>
              )}
              <div className="flex items-center gap-2">
                <Link
                  to="/"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" /> Customer App
                </Link>
                <button
                  onClick={async () => {
                    await signOut();
                    navigate('/login');
                  }}
                  className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-rose-900/40 text-slate-300 hover:text-rose-200 text-sm font-medium border border-slate-700 transition-all flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-4 h-4" /> Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: Authenticated Admin -> Render operational dashboard
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans flex flex-col">
      <EnvNoticeBanner />
      <div className="flex-1 flex min-h-0">
        <AdminSidebar />
        <main className="flex-1 overflow-y-auto p-8 bg-slate-900 text-slate-100">{children}</main>
      </div>
    </div>
  );
};
