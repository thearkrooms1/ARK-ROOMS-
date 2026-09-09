import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getVenues } from '../../lib/supabase';
import { Venue } from '../../types/database';
import { MapPin, Building2, Plus, Calendar } from 'lucide-react';

export const AdminVenuesPage: React.FC = () => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getVenues().then((data) => {
      setVenues(data);
      setLoading(false);
    });
  }, []);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Event Venues Index</h1>
            <p className="text-xs text-slate-400">
              Manage convention centres, church arenas, and summit venues used for spatial queries
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700">
            {venues.length} Indexed Venues
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {venues.map((venue) => (
            <div
              key={venue.id}
              className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col justify-between"
            >
              <div>
                <div className="h-40 overflow-hidden bg-slate-900 relative">
                  <img
                    src={
                      venue.image_url ||
                      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80'
                    }
                    alt={venue.name}
                    className="w-full h-full object-cover opacity-75"
                  />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-950/80 text-white text-[10px] font-bold">
                    {venue.city}, {venue.state}
                  </div>
                </div>

                <div className="p-5 space-y-3">
                  <div>
                    <h3 className="text-base font-bold text-white">{venue.name}</h3>
                    <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                      <Building2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                      {venue.category || 'Convention Centre'}
                    </p>
                  </div>

                  <p className="text-xs text-slate-400">{venue.address}</p>

                  <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 text-[11px] font-mono text-emerald-400 flex justify-between">
                    <span>GPS Coordinates:</span>
                    <span>{venue.latitude?.toFixed(4)}, {venue.longitude?.toFixed(4)}</span>
                  </div>
                </div>
              </div>

              <div className="p-5 pt-0">
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <span>Upcoming Events:</span>
                  <span className="font-bold text-amber-400">{venue.upcoming_events_count || 5}+</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
};
