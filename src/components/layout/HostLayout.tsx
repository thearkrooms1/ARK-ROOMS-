import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { EnvNoticeBanner } from '../ui/EnvNoticeBanner';
import {
  Building2,
  Home,
  CalendarCheck,
  User,
  LogOut,
  ArrowLeft,
  Lock,
  LogIn,
  ShieldAlert,
  Sparkles,
  ExternalLink,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';

interface HostLayoutProps {
  children: React.ReactNode;
}

export const HostLayout: React.FC<HostLayoutProps> = ({ children }) => {
  const { user, profile, isHost, hostProfile, hostStatus, isAdmin, loading, registerAsHost, signOut, toggleDevRole } =
    useAuth();
  const navigate = useNavigate();
  const [activating, setActivating] = React.useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] flex items-center justify-center font-sans text-slate-800">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[#1E7A5E] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Verifying Host Authorization...</p>
        </div>
      </div>
    );
  }

  // Case 1: Unauthenticated visitor -> Prompt to sign in
  if (!user) {
    return (
      <div className="min-h-screen bg-[#FDFBF7] text-slate-900 font-sans flex flex-col">
        <EnvNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#EAE3D2] rounded-3xl p-8 text-center shadow-xl space-y-6 animate-fadeIn">
            <div className="w-16 h-16 rounded-2xl bg-[#0B1F3A]/5 border border-[#0B1F3A]/15 text-[#0B1F3A] flex items-center justify-center mx-auto">
              <Lock className="w-8 h-8 text-[#C89B3C]" />
            </div>
            <div className="space-y-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-[#C89B3C]">TheArk Rooms Marketplace</span>
              <h2 className="text-2xl font-serif font-black text-[#0B1F3A]">Host Portal Access</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                You must sign in with an authorized host account to manage properties and host bookings.
              </p>
            </div>
            <div className="space-y-3 pt-2">
              <Link
                to="/login?redirect=/host/dashboard"
                className="w-full py-3.5 px-4 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2"
              >
                <LogIn className="w-4 h-4 text-[#C89B3C]" />
                <span>Sign In as Host</span>
              </Link>
              <Link
                to="/signup?type=host"
                className="w-full py-3 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-all flex items-center justify-center gap-2"
              >
                <Building2 className="w-4 h-4 text-[#1E7A5E]" />
                <span>Become a Host (Sign Up)</span>
              </Link>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors pt-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Return to Customer Homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 2: Suspended host
  if (hostStatus === 'suspended') {
    return (
      <div className="min-h-screen bg-[#FDFBF7] text-slate-900 font-sans flex flex-col">
        <EnvNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-rose-200 rounded-3xl p-8 text-center shadow-xl space-y-5 animate-fadeIn">
            <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-200 text-rose-600 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-serif font-black text-[#0B1F3A]">Host Account Suspended</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Your host privileges are currently suspended by marketplace administration.
                Please contact support to review your listings and verify your status.
              </p>
            </div>
            <div className="pt-2">
              <Link
                to="/"
                className="w-full py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-all flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Return to Homepage
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 3: Authenticated user is a Guest (not a host and not an admin inspecting)
  if (!isHost && !isAdmin) {
    const handleUpgradeToHost = async () => {
      try {
        setActivating(true);
        const { error } = await registerAsHost();
        if (error) {
          alert(error.message);
        } else {
          navigate('/host/dashboard');
        }
      } finally {
        setActivating(false);
      }
    };

    return (
      <div className="min-h-screen bg-[#FDFBF7] text-slate-900 font-sans flex flex-col">
        <EnvNoticeBanner />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-[#EAE3D2] rounded-3xl p-8 text-center shadow-xl space-y-5 animate-fadeIn">
            <div className="w-16 h-16 rounded-2xl bg-[#1E7A5E]/10 border border-[#1E7A5E]/20 text-[#1E7A5E] flex items-center justify-center mx-auto">
              <Building2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-[#C89B3C]">Host Registration Required</span>
              <h2 className="text-xl font-serif font-black text-[#0B1F3A]">Welcome to TheArk Rooms Host Portal</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                You are currently signed in as a <strong>Guest</strong> (<span className="text-slate-800 font-medium">{user.email}</span>).
                Activate your host profile to list your apartments and welcome guests.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs text-left text-slate-600 space-y-2">
              <div className="flex items-center gap-2 font-bold text-[#0B1F3A]">
                <CheckCircle2 className="w-4 h-4 text-[#1E7A5E]" />
                <span>Host account capabilities:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600 pl-1">
                <li>Submit apartment listings for admin review</li>
                <li>Manage availability and pricing</li>
                <li>Receive verified bookings from event attendees</li>
              </ul>
            </div>

            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={handleUpgradeToHost}
                disabled={activating}
                className="w-full py-3.5 px-4 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {activating ? (
                  <span>Activating Host Status...</span>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-[#C89B3C]" />
                    <span>Activate Host Account</span>
                  </>
                )}
              </button>
              <Link
                to="/"
                className="w-full py-3 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-all flex items-center justify-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Guest Experience</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Case 4: Authorized Host (or Admin inspecting)
  return (
    <div className="min-h-screen bg-[#FDFBF7] text-slate-900 font-sans flex flex-col">
      <EnvNoticeBanner />

      {/* Top Host Portal Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-[#EAE3D2] shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-4">
            <Link to="/host/dashboard" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-[#0B1F3A] flex items-center justify-center text-[#C89B3C] shadow-sm">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="leading-tight">
                <span className="font-serif font-black text-sm tracking-tight text-[#0B1F3A] block">
                  TheArk<span className="text-[#C89B3C]">Rooms</span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#1E7A5E] block">
                  Host Portal
                </span>
              </div>
            </Link>

            {/* Host Status Badge */}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Host: Active
            </span>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink
              to="/host/dashboard"
              end
              className={({ isActive }) =>
                `px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-[#0B1F3A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <Home className="w-4 h-4 text-[#C89B3C]" />
              <span>Dashboard</span>
            </NavLink>

            <NavLink
              to="/host/properties"
              className={({ isActive }) =>
                `px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-[#0B1F3A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <Building2 className="w-4 h-4 text-[#1E7A5E]" />
              <span>My Properties</span>
            </NavLink>

            <NavLink
              to="/host/bookings"
              className={({ isActive }) =>
                `px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-[#0B1F3A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <CalendarCheck className="w-4 h-4 text-[#C89B3C]" />
              <span>Bookings</span>
            </NavLink>

            <NavLink
              to="/host/profile"
              className={({ isActive }) =>
                `px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                  isActive
                    ? 'bg-[#0B1F3A] text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <User className="w-4 h-4 text-slate-500" />
              <span>Host Profile</span>
            </NavLink>
          </nav>

          {/* Right utility items */}
          <div className="flex items-center gap-3">
            {/* Dev Mode Role Switcher */}
            {import.meta.env.DEV && (
              <div className="hidden lg:flex items-center gap-1.5 p-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-600">
                <span className="px-1 text-slate-400">Dev:</span>
                <button
                  type="button"
                  onClick={() => toggleDevRole('customer')}
                  className="px-2 py-0.5 rounded bg-white hover:bg-slate-50 text-slate-700 shadow-xs cursor-pointer"
                  title="Switch role to Guest"
                >
                  Guest
                </button>
                <button
                  type="button"
                  onClick={() => toggleDevRole('host')}
                  className="px-2 py-0.5 rounded bg-[#0B1F3A] text-white shadow-xs cursor-pointer"
                  title="Switch role to Host"
                >
                  Host
                </button>
                <button
                  type="button"
                  onClick={() => toggleDevRole('admin')}
                  className="px-2 py-0.5 rounded bg-amber-500 text-slate-950 shadow-xs cursor-pointer"
                  title="Switch role to Admin"
                >
                  Admin
                </button>
              </div>
            )}

            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#1E7A5E]" />
              <span className="hidden sm:inline">Guest View</span>
            </Link>

            <button
              type="button"
              onClick={async () => {
                await signOut();
                navigate('/login');
              }}
              className="p-2 rounded-xl text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile Sub-Navigation Bar */}
        <div className="md:hidden border-t border-slate-100 px-4 py-2 flex items-center justify-between gap-1 overflow-x-auto">
          <NavLink
            to="/host/dashboard"
            end
            className={({ isActive }) =>
              `px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 ${
                isActive ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
              }`
            }
          >
            <Home className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </NavLink>
          <NavLink
            to="/host/properties"
            className={({ isActive }) =>
              `px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 ${
                isActive ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
              }`
            }
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Properties</span>
          </NavLink>
          <NavLink
            to="/host/bookings"
            className={({ isActive }) =>
              `px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 ${
                isActive ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
              }`
            }
          >
            <CalendarCheck className="w-3.5 h-3.5" />
            <span>Bookings</span>
          </NavLink>
          <NavLink
            to="/host/profile"
            className={({ isActive }) =>
              `px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 flex items-center gap-1.5 ${
                isActive ? 'bg-[#0B1F3A] text-white' : 'text-slate-600'
              }`
            }
          >
            <User className="w-3.5 h-3.5" />
            <span>Profile</span>
          </NavLink>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
};
