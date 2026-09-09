import React from 'react';
import { HostLayout } from '../../components/layout/HostLayout';
import { CalendarCheck, Clock, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export const HostBookingsPage: React.FC = () => {
  return (
    <HostLayout>
      <div className="space-y-6 animate-fadeIn">
        <div className="bg-white border border-[#EAE3D2] rounded-3xl p-6 md:p-8 shadow-sm space-y-1">
          <h1 className="text-2xl font-serif font-black text-[#0B1F3A]">Host Bookings</h1>
          <p className="text-xs text-slate-500">
            View confirmed reservations, arrival dates, and guest check-ins for your properties.
          </p>
        </div>

        <div className="bg-white border border-[#EAE3D2] rounded-3xl p-12 text-center shadow-xs space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <CalendarCheck className="w-7 h-7 text-[#C89B3C]" />
          </div>

          <div className="space-y-1.5 max-w-md mx-auto">
            <span className="text-[11px] font-bold uppercase tracking-widest text-[#1E7A5E]">Phase 2 Feature</span>
            <h3 className="text-lg font-serif font-black text-[#0B1F3A]">No Guest Bookings</h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              Once your properties are submitted and approved by admin in Phase 2, guest reservations will appear here.
            </p>
          </div>

          <div className="pt-2">
            <Link
              to="/host/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>
      </div>
    </HostLayout>
  );
};
