import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getBookings } from '../../lib/supabase';
import { Booking } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { Users, Mail, Phone, Calendar, Briefcase } from 'lucide-react';

export const AdminCustomersPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBookings().then((data) => {
      setBookings(data);
      setLoading(false);
    });
  }, []);

  // Aggregate customers from bookings
  const customerMap = new Map<string, any>();
  bookings.forEach((b) => {
    const email = (b.guest_email || b.customer_email || b.profile?.email || 'attendee@example.com').toLowerCase();
    const name = b.guest_name || `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.customer_name || b.profile?.full_name || 'Attendee';
    const phone = b.guest_phone || b.customer_phone || b.profile?.phone || 'N/A';
    const amount = b.total_amount || b.total_amount_ngn || 0;
    const isPaid = b.payment_status === 'paid' || b.payment_status === 'successful' || b.status === 'confirmed' || b.status === 'completed';

    if (!customerMap.has(email)) {
      customerMap.set(email, {
        name,
        email,
        phone,
        totalBookings: 1,
        totalSpentNGN: isPaid ? amount : 0,
        lastBookingDate: b.created_at,
      });
    } else {
      const existing = customerMap.get(email);
      existing.totalBookings += 1;
      if (isPaid) {
        existing.totalSpentNGN += amount;
      }
    }
  });

  const customers = Array.from(customerMap.values());

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Event Attendees Directory</h1>
            <p className="text-xs text-slate-400">
              Registered customers, corporate delegates, and trip histories
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700">
            {customers.length} Unique Attendees
          </span>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="p-4">Attendee Name</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Phone</th>
                  <th className="p-4">Total Trips</th>
                  <th className="p-4">Lifetime Spend (NGN)</th>
                  <th className="p-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {customers.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-900/50">
                    <td className="p-4 font-bold text-white flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-950 text-emerald-300 flex items-center justify-center font-bold text-xs border border-emerald-800">
                        {c.name.charAt(0)}
                      </div>
                      <span>{c.name}</span>
                    </td>
                    <td className="p-4 text-slate-300 font-mono">{c.email}</td>
                    <td className="p-4 text-slate-300">{c.phone}</td>
                    <td className="p-4 font-bold text-amber-400">{c.totalBookings}</td>
                    <td className="p-4 font-black text-emerald-400">{formatNGN(c.totalSpentNGN)}</td>
                    <td className="p-4 text-right">
                      <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-semibold">
                        Verified Attendee
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
