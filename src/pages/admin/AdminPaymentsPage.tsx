import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import { getBookings } from '../../lib/supabase';
import { Booking } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { CreditCard, ShieldCheck, DollarSign, ArrowUpRight, CheckCircle2 } from 'lucide-react';

export const AdminPaymentsPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBookings().then((data) => {
      setBookings(data);
      setLoading(false);
    });
  }, []);

  const totalCollectedNGN = bookings
    .filter((b) => b.payment_status === 'paid' || b.payment_status === 'successful' || b.status === 'confirmed' || b.status === 'completed')
    .reduce((sum, b) => sum + (b.total_amount || b.total_amount_ngn || 0), 0);

  const pendingNGN = bookings
    .filter((b) => b.payment_status === 'pending' || b.payment_status === 'unpaid' || b.status === 'pending_payment' || b.status === 'pending')
    .reduce((sum, b) => sum + (b.total_amount || b.total_amount_ngn || 0), 0);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <h1 className="text-2xl font-black text-white">Financial Transactions & Gateway Ledger</h1>
            <p className="text-xs text-slate-400">
              Paystack transactions, verified payouts, and automated customer receipts
            </p>
          </div>
          <span className="text-xs font-mono bg-slate-800 text-emerald-400 px-3 py-1.5 rounded-lg border border-slate-700">
            Paystack Integration: Verified
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
              Settled Volume (NGN)
            </span>
            <div className="text-2xl font-black text-emerald-400">{formatNGN(totalCollectedNGN)}</div>
            <p className="text-[11px] text-slate-500">Collected via Paystack</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
              Pending Volume (NGN)
            </span>
            <div className="text-2xl font-black text-amber-400">{formatNGN(pendingNGN)}</div>
            <p className="text-[11px] text-slate-500">Awaiting guest checkout</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-2">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">
              Total Transactions
            </span>
            <div className="text-2xl font-black text-white">{bookings.length}</div>
            <p className="text-[11px] text-slate-500">Across all event venues</p>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] font-bold border-b border-slate-800">
                <tr>
                  <th className="p-4">Reference</th>
                  <th className="p-4">Payer Details</th>
                  <th className="p-4">Amount (NGN)</th>
                  <th className="p-4">Gateway</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {bookings.map((b) => {
                  const guestName = b.guest_name || `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.customer_name || b.profile?.full_name || 'Attendee';
                  const guestEmail = b.guest_email || b.customer_email || b.profile?.email || 'N/A';
                  const amount = b.total_amount || b.total_amount_ngn || 0;
                  return (
                    <tr key={b.id} className="hover:bg-slate-900/50">
                      <td className="p-4 font-mono font-bold text-white">{b.booking_reference}</td>
                      <td className="p-4">
                        <div className="font-semibold text-slate-200">{guestName}</div>
                        <div className="text-[10px] text-slate-400">{guestEmail}</div>
                      </td>
                      <td className="p-4 font-bold text-emerald-400">{formatNGN(amount)}</td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300">
                          Paystack
                        </span>
                      </td>
                      <td className="p-4">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="p-4 text-right text-[11px] text-slate-400">
                        {new Date(b.created_at).toLocaleString()}
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
