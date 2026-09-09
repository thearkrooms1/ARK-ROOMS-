import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import {
  LayoutDashboard,
  CalendarCheck,
  Building,
  BedDouble,
  MapPin,
  Users,
  Truck,
  CreditCard,
  LogOut,
  Building2,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export const AdminSidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, profile } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const navItems = [
    { label: 'Dashboard', path: '/admin', icon: LayoutDashboard },
    { label: 'Bookings', path: '/admin/bookings', icon: CalendarCheck },
    { label: 'Properties', path: '/admin/properties', icon: Building },
    { label: 'Rooms', path: '/admin/rooms', icon: BedDouble },
    { label: 'Venues', path: '/admin/venues', icon: MapPin },
    { label: 'Customers', path: '/admin/customers', icon: Users },
    { label: 'Logistics', path: '/admin/logistics', icon: Truck },
    { label: 'Payments', path: '/admin/payments', icon: CreditCard },
  ];

  return (
    <aside className="w-64 bg-slate-950 text-slate-200 border-r border-slate-800 flex flex-col h-screen sticky top-0">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1E7A5E] to-[#0d382b] flex items-center justify-center text-[#C89B3C] font-bold">
          <Building2 className="w-5 h-5" />
        </div>
        <div>
          <span className="text-base font-black text-white block">TheArkRooms</span>
          <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider block">
            Operations Console
          </span>
        </div>
      </div>

      {/* Admin Profile Info */}
      <div className="px-5 py-3.5 bg-slate-900/60 border-b border-slate-800 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-emerald-700/50 border border-emerald-500/30 flex items-center justify-center text-emerald-300 font-bold text-xs">
          <ShieldCheck className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-white truncate">{profile?.full_name || 'Admin User'}</p>
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
            <UserCheck className="w-2.5 h-2.5" /> Authorized Operations
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1 overflow-y-auto text-sm">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.path === '/admin'
              ? location.pathname === '/admin'
              : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg font-medium transition-all ${
                isActive
                  ? 'bg-[#1E7A5E] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-[#C89B3C]' : 'text-slate-400'}`} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Sign out */}
      <div className="p-4 border-t border-slate-800 space-y-2">
        <Link
          to="/"
          className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg bg-slate-900 text-slate-300 hover:text-white border border-slate-800 text-xs font-medium transition-colors"
        >
          ← Return to Customer App
        </Link>
        <button
          onClick={handleSignOut}
          className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-medium border border-rose-900/50 transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sign Out
        </button>
      </div>
    </aside>
  );
};
