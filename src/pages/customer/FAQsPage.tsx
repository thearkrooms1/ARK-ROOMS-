import React, { useState } from 'react';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { ChevronDown, HelpCircle, ShieldCheck, CreditCard, Building2, Car } from 'lucide-react';

export const FAQsPage: React.FC = () => {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const faqs = [
    {
      q: 'How does TheArkRooms ensure properties are close to my event?',
      a: 'Unlike generic booking portals, TheArkRooms indexes properties specifically by physical road distance and drive time to major Nigerian convention halls, churches, and event centers. We filter out irrelevant options so you spend minimal time in traffic.',
    },
    {
      q: 'Are all properties physically inspected and verified?',
      a: 'Yes. Properties bearing the "Verified Stay" badge undergo thorough physical checks for uninterrupted power backup, functional air conditioning, clean water supply, Wi-Fi, and 24/7 premise security.',
    },
    {
      q: 'What payment methods are supported?',
      a: 'All transactions are priced and processed in Nigerian Naira (NGN) using Paystack and Flutterwave. You can pay securely with Nigerian debit/credit cards, direct bank transfers, or USSD.',
    },
    {
      q: 'How does the airport chauffeur pickup work?',
      a: 'When booking your stay, simply opt-in to airport pickup and input your incoming flight number. Our logistics team monitors flight radar in real time, so even if your flight is delayed, your executive driver will be waiting at the arrivals terminal holding a custom name placard.',
    },
    {
      q: 'Can I cancel or modify my reservation?',
      a: 'Cancellations and date modifications can be requested through your "My Trips" dashboard. Policies vary slightly by property, but most verified properties offer flexible cancellation up to 48 hours prior to check-in.',
    },
    {
      q: 'Do you cater to group delegations or corporate teams?',
      a: 'Yes! We frequently manage multi-room blocks and group logistics (executive HiAce buses, security escorts) for corporate summit delegations and church groups.',
    },
  ];

  return (
    <CustomerLayout>
      <div className="bg-[#0B1F3A] text-white py-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto space-y-4">
          <span className="text-xs font-bold uppercase tracking-wider text-[#C89B3C]">
            Got Questions? We Have Answers.
          </span>
          <h1 className="text-3xl sm:text-5xl font-black text-white">Frequently Asked Questions</h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            Everything you need to know about booking verified accommodation and event logistics with TheArkRooms.
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="space-y-4">
          {faqs.map((faq, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm transition-all"
              >
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  className="w-full text-left p-5 sm:p-6 flex items-center justify-between gap-4 font-bold text-sm sm:text-base text-[#0B1F3A] hover:text-[#1E7A5E] transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2.5">
                    <HelpCircle className="w-4 h-4 text-[#1E7A5E] shrink-0" />
                    {faq.q}
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                      isOpen ? 'rotate-180 text-[#1E7A5E]' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 sm:px-6 pb-6 pt-0 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100 mt-1">
                    <p className="pt-3">{faq.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </CustomerLayout>
  );
};
