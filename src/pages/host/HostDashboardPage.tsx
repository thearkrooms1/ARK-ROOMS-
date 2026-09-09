import React, { useState } from 'react';
import { HostLayout } from '../../components/layout/HostLayout';
import { useAuth } from '../../lib/authContext';
import {
  Building2,
  Clock,
  CheckCircle2,
  CalendarCheck,
  Plus,
  Sparkles,
  ShieldCheck,
  Info,
  X,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';

export const HostDashboardPage: React.FC = () => {
  const { user, profile } = useAuth();
  const [showComingSoonModal, setShowComingSoonModal] = useState(false);

  // Phase 1: Real initial values (no fake DB data)
  const stats = [
    {
      label: 'My Properties',
      value: 0,
      description: 'Total properties registered',
      icon: Building2,
      color: 'text-[#0B1F3A]',
      bg: 'bg-slate-100',
    },
    {
      label: 'Pending Review',
      value: 0,
      description: 'Awaiting admin approval',
      icon: Clock,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      label: 'Published',
      value: 0,
      description: 'Live & bookable on TheArk',
      icon: CheckCircle2,
      color: 'text-[#1E7A5E]',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Bookings',
      value: 0,
      description: 'Confirmed guest reservations',
      icon: CalendarCheck,
      color: 'text-[#C89B3C]',
      bg: 'bg-amber-50/60',
    },
  ];

  return (
    <HostLayout>
      <div className="space-y-8 animate-fadeIn">
        {/* Dashboard Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-[#EAE3D2] rounded-3xl p-6 md:p-8 shadow-sm">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#1E7A5E]/10 border border-[#1E7A5E]/20 text-[#1E7A5E] text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-[#C89B3C]" />
              <span>Host Operations &middot; Phase 1</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-serif font-black text-[#0B1F3A]">
              Host Dashboard
            </h1>
            <p className="text-xs md:text-sm text-slate-600 max-w-2xl leading-relaxed">
              Welcome to TheArk Rooms{profile?.full_name ? `, ${profile.full_name}` : ''}. List your property and welcome guests to your space.
            </p>
          </div>

          <button
            type="button"
            id="add-property-btn"
            onClick={() => setShowComingSoonModal(true)}
            className="self-start md:self-auto px-5 py-3 rounded-2xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center gap-2 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4 text-[#C89B3C]" />
            <span>Add a Property</span>
          </button>
        </div>

        {/* Real Metrics Grid (Phase 1 zero baseline) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, idx) => {
            const Icon = stat.icon;
            return (
              <div
                key={idx}
                className="bg-white border border-[#EAE3D2] rounded-3xl p-5 shadow-xs flex flex-col justify-between space-y-4 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.label}</span>
                  <div className={`w-9 h-9 rounded-2xl ${stat.bg} ${stat.color} flex items-center justify-center`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>

                <div>
                  <div className="text-3xl font-serif font-black text-[#0B1F3A]">{stat.value}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{stat.description}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Workflow Overview Banner */}
        <div className="bg-[#0B1F3A] text-white rounded-3xl p-6 md:p-8 shadow-md space-y-6">
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#C89B3C]">Marketplace Roadmap</span>
            <h2 className="text-xl font-serif font-black">How Hosting Works on TheArk Rooms</h2>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              All properties are independently owned and hosted by community partners, then vetted by our administration to guarantee premier quality for verified event guests.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="bg-white/10 rounded-2xl p-4 border border-white/10 space-y-2">
              <div className="w-7 h-7 rounded-xl bg-[#C89B3C] text-slate-950 font-black text-xs flex items-center justify-center">1</div>
              <h3 className="text-xs font-bold text-white">Create Host Account</h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Your host identity is securely provisioned with Row-Level Security. (Completed)
              </p>
            </div>

            <div className="bg-white/10 rounded-2xl p-4 border border-white/10 space-y-2">
              <div className="w-7 h-7 rounded-xl bg-white/20 text-white font-black text-xs flex items-center justify-center">2</div>
              <h3 className="text-xs font-bold text-white">List Your Apartment</h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Upload details, photos, venue proximity, and set your nightly rates. (Phase 2)
              </p>
            </div>

            <div className="bg-white/10 rounded-2xl p-4 border border-white/10 space-y-2">
              <div className="w-7 h-7 rounded-xl bg-white/20 text-white font-black text-xs flex items-center justify-center">3</div>
              <h3 className="text-xs font-bold text-white">Admin Review & Stays</h3>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                Admins approve the listing, and guests book your space as TheArk Rooms inventory. (Phase 2)
              </p>
            </div>
          </div>
        </div>

        {/* Empty State: Listings Section */}
        <div className="bg-white border border-[#EAE3D2] rounded-3xl p-8 shadow-xs text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
            <FolderOpen className="w-7 h-7" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h3 className="text-lg font-serif font-black text-[#0B1F3A]">No properties listed yet</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              When you submit your apartments and rooms, they will appear here along with their review status, pricing, and guest bookings.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShowComingSoonModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[#1E7A5E]" />
              <span>List Your First Property (Coming Next)</span>
            </button>
          </div>
        </div>
      </div>

      {/* "Add a Property" - Coming in Phase 2 Modal */}
      {showComingSoonModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn">
          <div className="max-w-md w-full bg-white rounded-3xl border border-[#EAE3D2] p-6 md:p-8 shadow-2xl space-y-5 relative">
            <button
              type="button"
              onClick={() => setShowComingSoonModal(false)}
              className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-[#0B1F3A]/5 border border-[#0B1F3A]/15 text-[#0B1F3A] flex items-center justify-center">
              <Building2 className="w-6 h-6 text-[#C89B3C]" />
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-widest text-[#1E7A5E]">Phase 2 Pipeline</span>
              <h3 className="text-xl font-serif font-black text-[#0B1F3A]">Apartment Listing Form</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                The property listing submission form and admin verification queue are scheduled for <strong>Phase 2</strong>.
              </p>
              <p className="text-xs text-slate-600 leading-relaxed pt-1">
                Your host account is now fully active, securely registered, and ready for listing creation as soon as Phase 2 opens.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 text-xs text-slate-600 space-y-1.5">
              <div className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#1E7A5E]" />
                <span>Security Notice:</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Submitted listings will be reviewed by marketplace administrators before appearing publicly in TheArk Rooms inventory.
              </p>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowComingSoonModal(false)}
                className="w-full py-3 px-4 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider shadow-md transition-all cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </HostLayout>
  );
};
