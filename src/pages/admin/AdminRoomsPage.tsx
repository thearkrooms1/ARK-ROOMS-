import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getRooms, getProperties } from '../../lib/supabase';
import { Room, Property } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { BedDouble, Users, Building, Plus, Check } from 'lucide-react';

export const AdminRoomsPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getRooms(), getProperties()]).then(([rData, pData]) => {
      setRooms(rData);
      setProperties(pData);
      setLoading(false);
    });
  }, []);

  const getPropName = (propertyId: string) => {
    const prop = properties.find((p) => p.id === propertyId);
    return prop?.title || 'Verified Property';
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Room Inventory & Rates</h1>
            <p className="text-xs text-slate-400">
              Manage room categories, occupancy limits, and nightly NGN pricing
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700">
            {rooms.length} Active Rooms
          </span>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="p-4">Room Title</th>
                  <th className="p-4">Property</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Max Occupancy</th>
                  <th className="p-4">Price / Night</th>
                  <th className="p-4">Amenities</th>
                  <th className="p-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {rooms.map((room) => (
                  <tr key={room.id} className="hover:bg-slate-900/50">
                    <td className="p-4">
                      <div className="font-bold text-white flex items-center gap-2">
                        <BedDouble className="w-4 h-4 text-emerald-400 shrink-0" />
                        <span>{room.name}</span>
                      </div>
                    </td>
                    <td className="p-4 font-medium text-slate-300">{getPropName(room.property_id)}</td>
                    <td className="p-4 text-slate-400 uppercase font-semibold text-[11px]">{room.room_type}</td>
                    <td className="p-4">
                      <span className="flex items-center gap-1 font-bold text-slate-200">
                        <Users className="w-3.5 h-3.5 text-[#C89B3C]" /> {room.capacity || room.max_occupancy || 2} guests
                      </span>
                    </td>
                    <td className="p-4 font-black text-emerald-400">{formatNGN(room.price_per_night)}</td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {room.amenities.slice(0, 2).map((a, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-slate-900 text-slate-400 rounded text-[10px]">
                            {a}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <span className="px-2.5 py-0.5 bg-emerald-950 text-emerald-300 border border-emerald-800 rounded-full text-[10px] font-bold">
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};
