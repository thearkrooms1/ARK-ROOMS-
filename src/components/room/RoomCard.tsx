import React from 'react';
import { Link } from 'react-router-dom';
import { Users, Bed, Check, Zap } from 'lucide-react';
import { Room } from '../../types/database';
import { formatNaira } from '../../lib/paystack';

export interface RoomCardProps {
  room: Room;
  propertyId: string;
  propertyName?: string;
  onSelect?: (room: Room) => void;
  selected?: boolean;
}

export const RoomCard: React.FC<RoomCardProps> = ({
  room,
  propertyId,
  propertyName,
  onSelect,
  selected = false,
}) => {
  return (
    <div
      className={`rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col justify-between bg-white ${
        selected
          ? 'border-[#C5A880] ring-2 ring-[#C5A880]/30 shadow-lg'
          : 'border-slate-200/90 hover:border-slate-300 hover:shadow-md'
      }`}
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
        <img
          src={
            room.image_url ||
            'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80'
          }
          alt={room.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute top-3 left-3 bg-[#0B1F3A]/90 backdrop-blur-sm text-white px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1.5 shadow">
          <Users className="w-3 h-3 text-[#C5A880]" />
          <span>Up to {room.capacity || 2} Guests</span>
        </div>
        {room.available_count !== undefined && room.available_count <= 3 && (
          <div className="absolute top-3 right-3 bg-amber-500/90 text-white px-2 py-0.5 rounded-full text-[10px] font-bold">
            Only {room.available_count} left
          </div>
        )}
      </div>

      <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#C5A880]">
              {room.room_type || 'Executive Suite'}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              {room.total_rooms ? `${room.total_rooms} units total` : 'Available'}
            </span>
          </div>
          <h4 className="font-serif text-lg font-bold text-slate-900 line-clamp-1">{room.name}</h4>
          {room.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
              {room.description}
            </p>
          )}

          {room.amenities && room.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {room.amenities.slice(0, 4).map((amenity, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium flex items-center gap-1"
                >
                  <Check className="w-2.5 h-2.5 text-[#C5A880]" />
                  {amenity}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Rate</span>
            <span className="font-serif text-lg font-bold text-slate-900">
              {formatNaira(room.price_per_night)}
            </span>
            <span className="text-[11px] text-slate-500"> / night</span>
          </div>

          {onSelect ? (
            <button
              type="button"
              onClick={() => onSelect(room)}
              className={`px-4 py-2 text-xs font-semibold rounded-xl transition-all cursor-pointer ${
                selected
                  ? 'bg-[#0B1F3A] text-white shadow'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800'
              }`}
            >
              {selected ? 'Selected' : 'Select Room'}
            </button>
          ) : (
            <Link
              to={`/checkout?propertyId=${propertyId}&roomId=${room.id}`}
              className="px-4 py-2 bg-[#0B1F3A] hover:bg-[#142d50] text-white text-xs font-semibold rounded-xl shadow transition-colors"
            >
              Reserve
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
