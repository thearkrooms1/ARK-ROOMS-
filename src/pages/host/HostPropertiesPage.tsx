import React from 'react';
import { HostLayout } from '../../components/layout/HostLayout';
import { Building2, Plus, Sparkles, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';

export const HostPropertiesPage: React.FC = () => {
  return (
    <HostLayout>
      <div className="space-y-6 animate-fadeIn">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#EAE3D2] rounded-3xl p-6 md:p-8 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-2xl font-serif font-black text-[#0B1F3A]">My Properties</h1>
            <p className="text-xs text-slate-500">
              Manage your apartment listings, pricing, and view publication status.
            </p>
          </div>

          <Link
            to="/host/dashboard"
            className="self-start sm:self-auto px-4 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4 text-[#C89B3C]" />
            <span>Add Property</span>
          </Link>
        </div>

        {/* Placeholder state */}
        <div className="bg-white border border-[#EAE3D2] rounded-3xl p-12 text-center shadow-xs space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#0B1F3A]/5 text-[#0B1F3A] flex items-center justify-center mx-auto">
            <Building2 className="w-7 h-7 text-[#C89B3C]" />
          </div>

          <div className="space-y-1.5 max-w-md mx-auto">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#1E7A5E]">Phase 2 Feature</span>
            <h3 className="text-lg font-serif font-black text-[#0B1F3A]">No Properties Yet</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Property creation, photos upload, amenity selection, and rate configuration will be activated in Phase 2.
            </p>
          </div>

          <div className="pt-2">
            <Link
              to="/host/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
            >
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>
      </div>
    </HostLayout>
  );
};
