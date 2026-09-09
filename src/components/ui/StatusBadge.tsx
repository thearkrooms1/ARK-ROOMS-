import React from 'react';

interface StatusBadgeProps {
  status: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const normalized = status.toLowerCase();
  let styleClass = 'bg-slate-100 text-slate-700 border-slate-200';
  let label = status.replace(/_/g, ' ');

  if (normalized === 'pending_payment') {
    styleClass = 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold';
    label = 'Awaiting Payment';
  } else if (['confirmed', 'successful', 'completed'].includes(normalized)) {
    styleClass = 'bg-emerald-50 text-emerald-800 border-emerald-200 font-medium';
  } else if (['pending', 'assigned'].includes(normalized)) {
    styleClass = 'bg-amber-50 text-amber-800 border-amber-200 font-medium';
  } else if (['cancelled', 'failed'].includes(normalized)) {
    styleClass = 'bg-rose-50 text-rose-800 border-rose-200 font-medium';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs border uppercase tracking-wider ${styleClass}`}>
      {label}
    </span>
  );
};
