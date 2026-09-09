import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getBookings } from '../../lib/supabase';
import { Booking } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Truck, Plane, Car, Clock, Phone, MapPin, CheckCircle2 } from 'lucide-react';

export const AdminLogisticsPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBookings().then((data) => {
      setBookings(data.filter((b) => b.has_logistics || b.logistics));
      setLoading(false);
    });
  }, []);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Chauffeur & Airport Logistics</h1>
            <p className="text-xs text-slate-400">
              Airport arrivals, flight monitoring, and executive driver assignment roster
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-emerald-400 px-3 py-1.5 rounded-lg border border-slate-700">
            {bookings.length} Airport Dispatches
          </span>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="p-4">Ref #</th>
                  <th className="p-4">Attendee & Phone</th>
                  <th className="p-4">Flight Number</th>
                  <th className="p-4">Arrival Date & Time</th>
                  <th className="p-4">Vehicle Category</th>
                  <th className="p-4">Destination Stay</th>
                  <th className="p-4 text-right">Dispatch Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {bookings.map((b) => {
                  const guestName = b.guest_name || `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.customer_name || b.profile?.full_name || 'Attendee';
                  const guestPhone = b.guest_phone || b.customer_phone || b.profile?.phone || 'N/A';
                  const flightNumber = b.logistics?.flight_number || b.logistics_details?.flight_number || 'TBD';
                  const arrDate = b.logistics?.arrival_date || b.logistics_details?.arrival_date || b.check_in;
                  const arrTime = b.logistics?.arrival_time || b.logistics_details?.arrival_time || '12:00';
                  const vehicleType = b.logistics?.service_name || b.logistics_details?.vehicle_type || 'Standard Sedan';

                  return (
                    <tr key={b.id} className="hover:bg-slate-900/50">
                      <td className="p-4 font-mono font-bold text-white">{b.booking_reference}</td>
                      <td className="p-4">
                        <div className="font-semibold text-white">{guestName}</div>
                        <div className="text-[10px] text-slate-400">{guestPhone}</div>
                      </td>
                      <td className="p-4 font-bold text-emerald-400 font-mono">
                        {flightNumber}
                      </td>
                      <td className="p-4">
                        <div>{arrDate}</div>
                        <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 text-[#C89B3C]" />
                          {arrTime}
                        </div>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 font-semibold text-slate-200 text-[10px]">
                          {vehicleType}
                        </span>
                      </td>
                      <td className="p-4 text-slate-300">
                        <div>{b.property?.title || 'Verified Stay'}</div>
                        <div className="text-[10px] text-slate-500">{b.property?.city || 'Lagos'}</div>
                      </td>
                      <td className="p-4 text-right">
                        <span className="px-2.5 py-1 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold">
                          Driver Assigned
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
};
