import React from 'react';
import { Link } from 'react-router-dom';
import { Star, MapPin, Zap } from 'lucide-react';

export interface PropertyCardProps {
  id: string;
  name: string;
  city: string;
  address: string;
  featured_image: string;
  price_per_night: number;
  rating?: number;
  review_count?: number;
  instant_book?: boolean;
}

export const PropertyCard: React.FC<PropertyCardProps> = ({
  id,
  name,
  city,
  address,
  featured_image,
  price_per_night,
  rating = 4.9,
  review_count = 18,
  instant_book = true,
}) => {
  return (
    <div className="group bg-white rounded-2xl overflow-hidden border border-slate-200/90 hover:border-slate-300 hover:shadow-xl transition-all duration-300 flex flex-col">
      {/* Image Banner */}
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        <img
          src={featured_image || 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=80'}
          alt={name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-3 left-3 bg-[#0B1F3A]/90 backdrop-blur-sm text-white px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 shadow">
          <MapPin className="w-3 h-3 text-[#C5A880]" />
          <span>{city}</span>
        </div>
        {instant_book && (
          <div className="absolute top-3 right-3 bg-emerald-700/90 backdrop-blur-sm text-white px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-300 fill-amber-300" /> Instant Book
          </div>
        )}
      </div>

      {/* Property Details */}
      <div className="p-5 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span className="line-clamp-1">{address}</span>
            <div className="flex items-center gap-1 text-slate-800 font-semibold shrink-0">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span>{rating.toFixed(1)}</span>
              <span className="text-slate-400 text-[10px]">({review_count})</span>
            </div>
          </div>
          <h3 className="font-serif text-lg font-bold text-slate-900 line-clamp-1 group-hover:text-[#0B1F3A] transition-colors">
            {name}
          </h3>
        </div>

        {/* Pricing & Booking Action */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-xs text-slate-500 block">From</span>
            <span className="font-serif text-lg font-bold text-slate-900">
              ₦{price_per_night.toLocaleString()}
            </span>
            <span className="text-[11px] text-slate-500"> / night</span>
          </div>

          <Link
            to={`/property/${id}`}
            className="px-4 py-2 bg-slate-900 hover:bg-[#0B1F3A] text-white text-xs font-semibold rounded-xl shadow transition-colors"
          >
            View Room
          </Link>
        </div>
      </div>
    </div>
  );
};
