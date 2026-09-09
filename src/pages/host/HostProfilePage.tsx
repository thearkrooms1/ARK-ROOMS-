import React from 'react';
import { HostLayout } from '../../components/layout/HostLayout';
import { useAuth } from '../../lib/authContext';
import { User, Mail, Phone, Globe, ShieldCheck, CheckCircle2, Lock } from 'lucide-react';

export const HostProfilePage: React.FC = () => {
  const { user, profile, hostProfile, hostStatus } = useAuth();

  return (
    <HostLayout>
      <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
        <div className="bg-white border border-[#EAE3D2] rounded-3xl p-6 md:p-8 shadow-sm space-y-1">
          <h1 className="text-2xl font-serif font-black text-[#0B1F3A]">Host Profile</h1>
          <p className="text-xs text-slate-500">
            View your verified host account credentials and marketplace standing.
          </p>
        </div>

        <div className="bg-white border border-[#EAE3D2] rounded-3xl p-6 md:p-8 shadow-xs space-y-6">
          <div className="flex items-center gap-4 pb-6 border-b border-slate-100">
            <div className="w-16 h-16 rounded-2xl bg-[#0B1F3A] text-[#C89B3C] flex items-center justify-center font-serif font-black text-xl shadow-md">
              {profile?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'H'}
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-[#0B1F3A]">{profile?.full_name || 'Apartment Host'}</h2>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Status: {hostStatus || 'active'}
                </span>
                <span className="text-xs text-slate-400">&middot;</span>
                <span className="text-xs text-slate-500 font-medium">TheArk Rooms Host</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-[#1E7A5E]" /> Email Address
              </span>
              <p className="font-bold text-slate-800 break-all">{user?.email || profile?.email || 'N/A'}</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#1E7A5E]" /> Phone
              </span>
              <p className="font-bold text-slate-800">{profile?.phone || 'Not specified'}</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[#1E7A5E]" /> Country / Region
              </span>
              <p className="font-bold text-slate-800">{profile?.country || 'Nigeria'}</p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-1">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#1E7A5E]" /> Base Account Role
              </span>
              <p className="font-bold text-slate-800 uppercase tracking-wide">{profile?.role || 'customer'}</p>
            </div>
          </div>

          {/* Security & Permissions Architecture Note */}
          <div className="p-4 bg-[#FDFBF7] border border-[#EAE3D2] rounded-2xl text-xs text-slate-600 space-y-2">
            <div className="flex items-center gap-2 font-bold text-[#0B1F3A]">
              <Lock className="w-4 h-4 text-[#C89B3C]" />
              <span>Host Isolation & Security Model</span>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-600">
              Host accounts are isolated through Row Level Security (RLS) in the database.
              Your host profile enables you to submit and manage your own apartment inventory.
              Marketplace operations and listings approval remain strictly under administrator control.
            </p>
          </div>
        </div>
      </div>
    </HostLayout>
  );
};
