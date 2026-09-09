import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getProperties, getVenues } from '../../lib/supabase';
import { Property, Venue } from '../../types/database';
import { Building, MapPin, ShieldCheck, Plus, Star, CheckCircle2 } from 'lucide-react';

export const AdminPropertiesPage: React.FC = () => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getProperties(), getVenues()]).then(([pData, vData]) => {
      setProperties(pData);
      setVenues(vData);
      setLoading(false);
    });
  }, []);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Properties Directory</h1>
            <p className="text-xs text-slate-400">
              Manage verified accommodations, inventory, and venue distance mappings
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700">
            {properties.length} Active Stays
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map((prop) => (
            <div
              key={prop.id}
              className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex flex-col justify-between"
            >
              <div>
                <div className="h-44 overflow-hidden bg-slate-900 relative">
                  <img
                    src={
                      prop.image_url ||
                      prop.photos?.[0] ||
                      'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'
                    }
                    alt={prop.title}
                    className="w-full h-full object-cover opacity-80"
                  />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-950/80 text-white text-[10px] font-bold">
                    {prop.property_type}
                  </div>
                  {prop.is_verified && (
                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Verified
                    </div>
                  )}
                </div>

                <div className="p-5 space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-base font-bold text-white line-clamp-1">{prop.title}</h3>
                    <p className="text-xs text-slate-400 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      {prop.address}, {prop.city}
                    </p>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-xl border border-slate-800/80 text-xs space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Coordinates:</span>
                      <span className="font-mono text-emerald-400">
                        {prop.latitude?.toFixed(4)}, {prop.longitude?.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Mapped Distance:</span>
                      <span className="font-bold text-amber-400">
                        {prop.distance_to_venue_km ? `${prop.distance_to_venue_km} km to Venue` : 'Verified nearby'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 pt-0">
                <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Rating: {prop.rating} ★</span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 font-medium">
                    {prop.amenities.length} Amenities
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
};
