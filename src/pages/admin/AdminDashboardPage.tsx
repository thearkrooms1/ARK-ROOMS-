import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getBookings, getProperties, getVenues } from '../../lib/supabase';
import { Booking, Property, Venue } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  LayoutDashboard,
  CalendarCheck,
  Building,
  MapPin,
  CreditCard,
  Truck,
  TrendingUp,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getBookings(), getProperties(), getVenues()]).then(([bData, pData, vData]) => {
      setBookings(bData);
      setProperties(pData);
      setVenues(vData);
      setLoading(false);
    });
  }, []);

  const totalRevenue = bookings
    .filter((b) => b.payment_status === 'paid' || b.payment_status === 'successful' || b.status === 'confirmed' || b.status === 'completed')
    .reduce((sum, b) => sum + (b.total_amount || b.total_amount_ngn || 0), 0);

  const pendingLogistics = bookings.filter((b) => b.has_logistics || b.logistics);

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Operations Control Center</h1>
            <p className="text-xs text-slate-400">
              Overview of real-time event stays, guest check-ins, and logistics dispatch
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-emerald-400 px-3 py-1.5 rounded-lg border border-slate-700">
            Authoritative Ledger (NGN)
          </span>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Total Revenue</span>
              <CreditCard className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-white">{formatNGN(totalRevenue)}</div>
            <p className="text-[11px] text-emerald-400 font-medium">All verified NGN receipts</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Total Reservations</span>
              <CalendarCheck className="w-4 h-4 text-[#C89B3C]" />
            </div>
            <div className="text-2xl font-black text-white">{bookings.length}</div>
            <p className="text-[11px] text-slate-400 font-medium">Event stay bookings</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Verified Properties</span>
              <Building className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-black text-white">{properties.length}</div>
            <p className="text-[11px] text-slate-400 font-medium">Inspected accommodations</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between text-slate-400 text-xs font-bold uppercase tracking-wider">
              <span>Active Venues</span>
              <MapPin className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-white">{venues.length}</div>
            <p className="text-[11px] text-slate-400 font-medium">Major event centers indexed</p>
          </div>
        </div>

        {/* Recent Reservations Table */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-white">Recent Event Reservations</h3>
            <Link
              to="/admin/bookings"
              className="text-xs font-bold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
            >
              View All Bookings <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Stay & Venue</th>
                  <th className="p-3">Dates</th>
                  <th className="p-3">Total (NGN)</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {bookings.slice(0, 5).map((b) => {
                  const guestName = b.guest_name || `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.profile?.full_name || 'Customer';
                  const amount = b.total_amount || b.total_amount_ngn || 0;
                  return (
                    <tr key={b.id} className="hover:bg-slate-900/50">
                      <td className="p-3 font-mono font-bold text-white">{b.booking_reference}</td>
                      <td className="p-3 font-semibold text-slate-200">{guestName}</td>
                      <td className="p-3">
                        <div>{b.property?.title || 'Property'}</div>
                        {b.venue && <div className="text-[10px] text-slate-400">{b.venue.name}</div>}
                      </td>
                      <td className="p-3">
                        {b.check_in} → {b.check_out}
                      </td>
                      <td className="p-3 font-bold text-emerald-400">{formatNGN(amount)}</td>
                      <td className="p-3">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="p-3 text-right">
                        <Link
                          to={`/admin/bookings`}
                          className="text-xs font-bold text-[#C89B3C] hover:underline"
                        >
                          Manage
                        </Link>
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
