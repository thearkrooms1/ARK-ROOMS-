import React from 'react';
import { useAuth } from '../../lib/authContext';
import { Database, AlertTriangle, Shield, ShieldAlert, CheckCircle2 } from 'lucide-react';

export const EnvNoticeBanner: React.FC = () => {
  if (!import.meta.env.DEV) {
    return null;
  }

  const { isConfigured, profile, isAdmin, toggleDevRole } = useAuth();

  return (
    <div className="bg-[#0B1F3A] text-white border-b border-slate-800 px-4 py-2 text-xs">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {isConfigured ? (
            <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Connected to Live Supabase Database
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-amber-400 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              Supabase Environment Variables Not Set (Using Interactive Local Store)
            </span>
          )}
        </div>
        {import.meta.env.DEV && (
          <div className="flex items-center gap-3">
            <span className="text-slate-400 hidden sm:inline">Dev Mode:</span>
            <button
              onClick={() => toggleDevRole('customer')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                !isAdmin ? 'bg-[#1E7A5E] text-white font-medium' : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <Shield className="w-3 h-3" />
              Customer View
            </button>
            <button
              onClick={() => toggleDevRole('admin')}
              className={`px-2.5 py-1 rounded transition-colors flex items-center gap-1 ${
                isAdmin ? 'bg-[#C89B3C] text-slate-950 font-bold' : 'bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <ShieldAlert className="w-3 h-3" />
              Admin Operations
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
