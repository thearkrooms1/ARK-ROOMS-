import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getBookings, updateBookingStatus } from '../../lib/supabase';
import { Booking } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { CalendarCheck, Search, Filter, CheckCircle2, XCircle, Clock } from 'lucide-react';

export const AdminBookingsPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const fetchAll = () => {
    setLoading(true);
    getBookings().then((data) => {
      setBookings(data);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleStatusChange = async (bookingId: string, newStatus: any) => {
    try {
      await updateBookingStatus(bookingId, newStatus);
      fetchAll();
    } catch (err) {
      console.error('Failed to update booking status', err);
    }
  };

  const filtered = bookings.filter((b) => {
    const guestName = b.guest_name || `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.profile?.full_name || '';
    const guestEmail = b.guest_email || b.profile?.email || '';
    if (statusFilter !== 'all' && b.status !== statusFilter && b.payment_status !== statusFilter) return false;
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      (b.booking_reference && b.booking_reference.toLowerCase().includes(term)) ||
      guestName.toLowerCase().includes(term) ||
      guestEmail.toLowerCase().includes(term) ||
      (b.property?.title && b.property.title.toLowerCase().includes(term))
    );
  });

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Event Reservations Management</h1>
            <p className="text-xs text-slate-400">
              Manage attendee bookings, track stay payments, and approve room passes
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-slate-300 px-3 py-1.5 rounded-lg border border-slate-700">
            {bookings.length} Total Bookings
          </span>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-950 p-4 rounded-2xl border border-slate-800">
          <div className="sm:col-span-2 relative">
            <input
              type="text"
              placeholder="Search by reference, attendee name, email, or stay..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="all">All Payment Statuses</option>
              <option value="paid">Paid & Confirmed</option>
              <option value="pending_payment">Awaiting Payment</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="p-4">Ref #</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4">Stay & Venue</th>
                  <th className="p-4">Dates</th>
                  <th className="p-4">Total (NGN)</th>
                  <th className="p-4">Logistics</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {filtered.map((b) => {
                  const guestName = b.guest_name || `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.profile?.full_name || 'Customer';
                  const guestEmail = b.guest_email || b.profile?.email || 'N/A';
                  const amount = b.total_amount || b.total_amount_ngn || 0;
                  const isPaid = b.payment_status === 'paid' || b.payment_status === 'successful' || b.status === 'confirmed' || b.status === 'completed';
                  return (
                    <tr key={b.id} className="hover:bg-slate-900/50">
                      <td className="p-4 font-mono font-bold text-white">{b.booking_reference}</td>
                      <td className="p-4">
                        <div className="font-semibold text-slate-200">{guestName}</div>
                        <div className="text-[10px] text-slate-400">{guestEmail}</div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-white">{b.property?.title || 'Stay'}</div>
                        <div className="text-[10px] text-slate-400">{b.room?.name || 'Room'}</div>
                      </td>
                      <td className="p-4 text-[11px]">
                        {b.check_in} → {b.check_out}
                      </td>
                      <td className="p-4 font-bold text-emerald-400">{formatNGN(amount)}</td>
                      <td className="p-4">
                        {b.has_logistics || b.logistics ? (
                          <span className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[10px] font-bold">
                            Airport Pickup
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[10px]">None</span>
                        )}
                      </td>
                      <td className="p-4">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="p-4 text-right">
                        {!isPaid ? (
                          <button
                            onClick={() => handleStatusChange(b.id, 'confirmed')}
                            className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 text-white rounded font-bold text-[10px] transition-colors cursor-pointer"
                          >
                            Mark Paid
                          </button>
                        ) : (
                          <button
                            onClick={() => handleStatusChange(b.id, 'pending')}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-[10px] transition-colors cursor-pointer"
                          >
                            Set Pending
                          </button>
                        )}
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
