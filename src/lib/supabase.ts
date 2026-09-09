import { createClient } from '@supabase/supabase-js';
import {
  INITIAL_VENUES,
  INITIAL_PROPERTIES,
  INITIAL_ROOMS,
  INITIAL_BOOKINGS,
  INITIAL_PAYMENTS,
  INITIAL_LOGISTICS,
} from './mockData';
import { Venue, Property, Room, Booking, Payment, LogisticsRequest, Profile, SelectedLogisticsService, LogisticsType, BookingStatus, LogisticsStatus, HostProfile, HostStatus } from '../types/database';

// Support both NEXT_PUBLIC_ and VITE_ prefix naming conventions
const metaEnv: Record<string, string | undefined> = (import.meta as any).env || {};
const procEnv: Record<string, string | undefined> = (typeof process !== 'undefined' && process.env) ? (process.env as any) : {};

export const isDemoMode = (): boolean => {
  return (
    metaEnv.VITE_DEMO_MODE === 'true' ||
    procEnv.VITE_DEMO_MODE === 'true' ||
    metaEnv.VITE_ENABLE_DEMO_MODE === 'true'
  );
};

const rawUrl =
  metaEnv.VITE_SUPABASE_URL ||
  metaEnv.NEXT_PUBLIC_SUPABASE_URL ||
  procEnv.VITE_SUPABASE_URL ||
  procEnv.NEXT_PUBLIC_SUPABASE_URL ||
  '';

const rawAnonKey =
  metaEnv.VITE_SUPABASE_ANON_KEY ||
  metaEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  procEnv.VITE_SUPABASE_ANON_KEY ||
  procEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

// Trim, strip surrounding quotes, and automatically fix hostname/TLD typo if present
export const supabaseUrl = rawUrl
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace('dadwdteyaugevbqscjzn', 'dadwtevyaugevbqscjzn')
  .replace(/\.supabase\.com(\/.*)?$/, (_m, p) => `.supabase.co${p || ''}`);

export const supabaseAnonKey = rawAnonKey.trim().replace(/^["']|["']$/g, '');

export const isSupabaseConfigured = (): boolean => {
  const urlLower = supabaseUrl.toLowerCase();
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseAnonKey) &&
    !urlLower.includes('your-project-id') &&
    !urlLower.includes('placeholder') &&
    supabaseUrl.startsWith('https://')
  );
};

// Create Supabase Client - single instance reused across application
export const supabase = createClient(
  isSupabaseConfigured() ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured() ? supabaseAnonKey : 'placeholder-key'
);

export async function withTimeout<T>(
  promise: PromiseLike<T> | Promise<T>,
  ms: number = 10000,
  errorMsg = 'Operation timed out'
): Promise<T> {
  let timeoutId: any;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(errorMsg || `Query timed out after ${ms}ms`)),
      ms
    );
  });
  try {
    const result = await Promise.race([Promise.resolve(promise), timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEGACY_ID_MAP: Record<string, string> = {
  // Venues
  'venue-1': '10000000-0000-4000-8000-000000000001',
  'venue-2': '10000000-0000-4000-8000-000000000002',
  'venue-3': '10000000-0000-4000-8000-000000000003',
  'venue-4': '10000000-0000-4000-8000-000000000004',
  'venue-5': '10000000-0000-4000-8000-000000000005',
  // Properties
  'prop-1': '20000000-0000-4000-8000-000000000001',
  'prop-2': '20000000-0000-4000-8000-000000000002',
  'prop-3': '20000000-0000-4000-8000-000000000003',
  'prop-4': '20000000-0000-4000-8000-000000000004',
  'prop-5': '20000000-0000-4000-8000-000000000005',
  'prop-6': '20000000-0000-4000-8000-000000000006',
  'prop-7': '20000000-0000-4000-8000-000000000007',
  'prop-8': '20000000-0000-4000-8000-000000000008',
  // Rooms
  'room-101': '30000000-0000-4000-8000-000000000101',
  'room-201': '30000000-0000-4000-8000-000000000201',
  'room-301': '30000000-0000-4000-8000-000000000301',
  'room-401': '30000000-0000-4000-8000-000000000401',
  'room-501': '30000000-0000-4000-8000-000000000501',
  'room-601': '30000000-0000-4000-8000-000000000601',
  'room-701': '30000000-0000-4000-8000-000000000701',
  'room-801': '30000000-0000-4000-8000-000000000801',
};

export function sanitizeToUuid(idStr?: string): string | undefined {
  if (!idStr) return undefined;
  if (LEGACY_ID_MAP[idStr]) return LEGACY_ID_MAP[idStr];
  if (UUID_REGEX.test(idStr)) return idStr;
  return idStr;
}

// Memory fallback store for interactive UI testing when Supabase env vars are empty
const memoryStore = {
  venues: [...INITIAL_VENUES],
  properties: [...INITIAL_PROPERTIES],
  rooms: [...INITIAL_ROOMS],
  bookings: [...INITIAL_BOOKINGS],
  payments: [...INITIAL_PAYMENTS],
  logistics: [...INITIAL_LOGISTICS],
  profiles: [] as Profile[],
  hostProfiles: [] as HostProfile[],
};

// Mapping Helpers for Supabase DB entities to application TypeScript types
export function mapDbRoomToAppRoom(dbRoom: any): Room {
  if (!dbRoom) return dbRoom;
  // 1. Price mapping: price_per_night = price_per_night_ngn
  const price = dbRoom.price_per_night_ngn !== undefined && dbRoom.price_per_night_ngn !== null
    ? Number(dbRoom.price_per_night_ngn)
    : Number(dbRoom.price_per_night ?? 0);

  // 2. Capacity mapping: capacity = max_guests
  const capacity = dbRoom.max_guests !== undefined && dbRoom.max_guests !== null
    ? Number(dbRoom.max_guests)
    : Number(dbRoom.capacity ?? 1);

  // 3. Status mapping: status is BOOLEAN in Supabase (true = available)
  const isAvailable = typeof dbRoom.status === 'boolean'
    ? dbRoom.status
    : dbRoom.status !== 'maintenance' && dbRoom.status !== false && dbRoom.status !== 'sold_out' && dbRoom.status !== 'inactive';

  const totalRooms = Number(dbRoom.total_rooms ?? (isAvailable ? (dbRoom.available_rooms ?? dbRoom.available_count ?? 10) : 10));
  const availableCount = isAvailable ? Number(dbRoom.available_rooms ?? dbRoom.available_count ?? totalRooms) : 0;

  return {
    id: dbRoom.id,
    property_id: dbRoom.property_id,
    name: dbRoom.name || 'Standard Room',
    description: dbRoom.description || '',
    room_type: dbRoom.room_type || dbRoom.name || 'Standard Room',
    price_per_night: price,
    price_per_night_ngn: price,
    capacity: capacity,
    max_guests: capacity,
    total_rooms: totalRooms,
    available_count: availableCount,
    status: dbRoom.status,
    is_active: isAvailable,
    amenities: Array.isArray(dbRoom.amenities) ? dbRoom.amenities : [],
    image_url: dbRoom.image_url || undefined,
    created_at: dbRoom.created_at || new Date().toISOString(),
    updated_at: dbRoom.updated_at || undefined,
    property: dbRoom.property ? mapDbPropertyToAppProperty(dbRoom.property) : undefined,
  };
}

export function mapDbPropertyToAppProperty(dbProp: any): Property {
  if (!dbProp) return dbProp;
  const rawDist = dbProp.distance_to_venue_km ?? dbProp.distance_km ?? dbProp.distance ?? null;
  const distance_to_venue_km = (rawDist !== null && rawDist !== undefined && !isNaN(Number(rawDist)))
    ? Number(Number(rawDist).toFixed(2))
    : null;

  return {
    ...dbProp,
    id: dbProp.id,
    venue_id: dbProp.venue_id,
    title: dbProp.title || dbProp.name || 'Property',
    description: dbProp.description || '',
    property_type: dbProp.property_type || 'hotel',
    address: dbProp.address || '',
    city: dbProp.city || 'Abuja',
    state: dbProp.state || 'FCT',
    country: dbProp.country || 'Nigeria',
    latitude: dbProp.latitude ?? null,
    longitude: dbProp.longitude ?? null,
    distance_to_venue_km,
    rating: dbProp.rating ?? 4.8,
    is_verified: dbProp.is_verified ?? true,
    amenities: Array.isArray(dbProp.amenities) ? dbProp.amenities : [],
    check_in_time: dbProp.check_in_time || '14:00',
    check_out_time: dbProp.check_out_time || '11:00',
    image_url: dbProp.image_url || undefined,
    photos: Array.isArray(dbProp.photos) ? dbProp.photos : (dbProp.image_url ? [dbProp.image_url] : []),
    phone: dbProp.phone,
    email: dbProp.email,
    website: dbProp.website,
    venue: dbProp.venue ? dbProp.venue : undefined,
    created_at: dbProp.created_at || new Date().toISOString(),
  };
}

export function mapDbBookingToAppBooking(dbBooking: any): Booking {
  if (!dbBooking) return dbBooking;
  const property = dbBooking.property ? mapDbPropertyToAppProperty(dbBooking.property) : undefined;
  const room = dbBooking.room ? mapDbRoomToAppRoom(dbBooking.room) : undefined;

  let nights = dbBooking.nights;
  if (!nights && dbBooking.check_in && dbBooking.check_out) {
    const diffTime = Math.abs(new Date(dbBooking.check_out).getTime() - new Date(dbBooking.check_in).getTime());
    nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }

  const guestNameParts = (dbBooking.guest_name || '').trim().split(' ');
  const firstName = dbBooking.guest_first_name || guestNameParts[0] || '';
  const lastName = dbBooking.guest_last_name || guestNameParts.slice(1).join(' ') || '';

  const rawBookingRef = dbBooking.booking_reference || dbBooking.reference;
  const isRefValid = rawBookingRef && !UUID_REGEX.test(rawBookingRef);
  const fallbackRef = (dbBooking.id && !UUID_REGEX.test(dbBooking.id))
    ? dbBooking.id
    : `ARK-${new Date(dbBooking.created_at || Date.now()).getFullYear()}-${String(dbBooking.id || 'PEND').substring(0, 5).toUpperCase()}`;

  return {
    id: dbBooking.id,
    booking_reference: isRefValid ? rawBookingRef : (dbBooking.booking_reference || fallbackRef),
    user_id: dbBooking.user_id,
    property_id: dbBooking.property_id,
    room_id: dbBooking.room_id,
    venue_id: dbBooking.venue_id || property?.venue_id || '',
    guest_first_name: firstName,
    guest_last_name: lastName,
    guest_email: dbBooking.guest_email || '',
    guest_phone: dbBooking.guest_phone || '',
    country: dbBooking.country || 'Nigeria',
    passport_name: dbBooking.passport_name || '',
    special_requests: dbBooking.special_requests || '',
    check_in: dbBooking.check_in,
    check_out: dbBooking.check_out,
    nights: nights || 1,
    guests: Number(dbBooking.number_of_guests ?? dbBooking.guests ?? 1),
    accommodation_subtotal: Number(dbBooking.room_total_ngn ?? dbBooking.accommodation_subtotal ?? 0),
    logistics_subtotal: Number(dbBooking.logistics_total_ngn ?? dbBooking.logistics_subtotal ?? 0),
    total_amount: Number(dbBooking.total_amount_ngn ?? dbBooking.total_amount ?? 0),
    damage_deposit_ngn: Number(dbBooking.damage_deposit_ngn ?? 0),
    currency: 'NGN',
    status: (dbBooking.booking_status || dbBooking.status || 'pending') as any,
    payment_status: (dbBooking.payment_status || 'unpaid') as any,
    expires_at: dbBooking.expires_at || undefined,
    created_at: dbBooking.created_at || new Date().toISOString(),
    property,
    room,
    venue: dbBooking.venue || property?.venue,
  };
}

// Data retrieval wrappers with Supabase as primary source of truth
export async function getVenues(): Promise<Venue[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase.from('venues').select('*').order('name');
    if (error) {
      console.error('[SUPABASE] getVenues failed:', error.message, error);
      throw new Error(`Failed to load venues from database: ${error.message}`);
    }
    if (data) {
      return (data as Venue[]).filter((v) => v.status !== false);
    }
    return [];
  }
  return memoryStore.venues.filter((v) => v.status !== false);
}

export async function getVenueById(venueId: string): Promise<Venue | null> {
  const sanitizedVenueId = sanitizeToUuid(venueId) || venueId;
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await withTimeout(
      supabase.from('venues').select('*').eq('id', sanitizedVenueId).maybeSingle(),
      10000,
      'Venue lookup timed out'
    );
    if (error) {
      console.error('[SUPABASE] getVenueById failed:', error.message, error);
      throw new Error(`Failed to load venue from database: ${error.message}`);
    }
    return data ? (data as Venue) : null;
  }
  return memoryStore.venues.find((v) => v.id === venueId || v.id === sanitizedVenueId) || null;
}

export async function getProperties(venueId?: string): Promise<Property[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    let query = supabase.from('properties').select('*');
    if (venueId) {
      query = query.eq('venue_id', venueId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('[SUPABASE] getProperties failed:', error.message, error);
      throw new Error(`Failed to load properties from database: ${error.message}`);
    }
    return data ? data.map(mapDbPropertyToAppProperty) : [];
  }
  let props = memoryStore.properties;
  if (venueId) {
    props = props.filter((p) => p.venue_id === venueId);
  }
  return props.map((p) => mapDbPropertyToAppProperty({
    ...p,
    venue: memoryStore.venues.find((v) => v.id === p.venue_id),
  }));
}

export interface SearchDiagnosticsParams {
  venueId: string;
  checkIn?: string;
  checkOut?: string;
  guests: number;
  searchRadiusKm?: number;
}

export interface PropertyDiagnosticItem {
  id: string;
  name: string;
  propertyType: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  withinRadius: boolean;
}

export interface RpcMatchItem {
  id: string;
  name: string;
  distanceKm: number | null;
}

export interface SearchDiagnosticData {
  venue: Venue | null;
  venueId: string;
  venueName: string;
  venueLat: number | null;
  venueLng: number | null;
  checkIn: string;
  checkOut: string;
  guests: number;
  searchRadiusKm: number;
  rpcFunction: string;
  rpcParams: {
    venue_lat: number | null;
    venue_lng: number | null;
    max_distance_km: number;
  } | null;
  rpcStatus: 'SUCCESS' | 'ERROR' | 'NOT_STARTED';
  searchNotStarted?: boolean;
  propertiesReturnedCount: number;
  rpcError: string | null;
  totalProperties: number;
  propertiesWithLat: number;
  propertiesWithLng: number;
  propertiesWithBoth: number;
  totalRooms: number;
  activeRooms: number;
  roomsWithInventory: number;
  roomsForGuestCount: number;
  allPropertyDiagnostics: PropertyDiagnosticItem[];
  rpcMatches: RpcMatchItem[];
}

export function formatVenueDistance(distanceKm: number | null | undefined, venueName?: string): string {
  if (distanceKm === null || distanceKm === undefined || distanceKm <= 0) {
    return 'Location being verified';
  }
  return venueName ? `${distanceKm} km to ${venueName}` : `${distanceKm} km to Venue`;
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function searchPropertiesDiagnostics(params: SearchDiagnosticsParams): Promise<{
  properties: Property[];
  venue: Venue | null;
  diagnostics: SearchDiagnosticData;
}> {
  const { venueId, checkIn, checkOut, guests, searchRadiusKm = 10 } = params;

  // STRICT GUARD: If venueId is empty, DO NOT call RPC or execute queries
  if (!venueId) {
    return {
      properties: [],
      venue: null,
      diagnostics: {
        venue: null,
        venueId: '',
        venueName: 'No venue selected',
        venueLat: null,
        venueLng: null,
        checkIn: checkIn || '',
        checkOut: checkOut || '',
        guests,
        searchRadiusKm,
        rpcFunction: 'get_nearby_properties',
        rpcParams: null,
        rpcStatus: 'NOT_STARTED',
        searchNotStarted: true,
        propertiesReturnedCount: 0,
        rpcError: null,
        totalProperties: 0,
        propertiesWithLat: 0,
        propertiesWithLng: 0,
        propertiesWithBoth: 0,
        totalRooms: 0,
        activeRooms: 0,
        roomsWithInventory: 0,
        roomsForGuestCount: 0,
        allPropertyDiagnostics: [],
        rpcMatches: [],
      },
    };
  }

  // 1. Fetch Venue from Supabase
  const venue = await getVenueById(venueId);
  const venueLat = venue?.latitude ?? null;
  const venueLng = venue?.longitude ?? null;
  const hasCoordinates = venueLat !== null && venueLat !== undefined && venueLng !== null && venueLng !== undefined;

  // 2. Proximity search setup
  const rpcName = 'get_nearby_properties';
  const rpcParams = {
    venue_lat: venueLat,
    venue_lng: venueLng,
    max_distance_km: searchRadiusKm,
  };

  let rpcData: any = null;
  let rpcError: any = null;
  let returnedProperties: Property[] = [];

  if (isSupabaseConfigured() && !isDemoMode()) {
    // Only attempt RPC if venue coordinates are valid (never call RPC with null coordinates)
    if (hasCoordinates) {
      try {
        const { data, error } = await withTimeout(
          supabase.rpc(rpcName, rpcParams) as unknown as Promise<any>,
          2000
        );
        if (!error && data && Array.isArray(data) && data.length > 0) {
          rpcData = data;
          returnedProperties = data.map(mapDbPropertyToAppProperty);
        } else {
          rpcError = error;
        }
      } catch (err: any) {
        rpcError = err;
      }
    } else {
      rpcError = new Error('Selected venue has no valid latitude/longitude coordinates for spatial search.');
    }

    // If RPC returned 0 properties or had an error, query Supabase properties directly & compute distance
    if (returnedProperties.length === 0) {
      try {
        const { data: dbProps, error: dbErr } = await withTimeout(supabase.from('properties').select('*') as unknown as Promise<any>, 2500);
        if (!dbErr && dbProps && Array.isArray(dbProps)) {
          const mapped = dbProps.map(mapDbPropertyToAppProperty);
          if (hasCoordinates && venueLat !== null && venueLng !== null) {
            returnedProperties = mapped
              .map((p) => {
                if (p.latitude === null || p.longitude === null) return null;
                const dist = haversineDistanceKm(venueLat, venueLng, p.latitude, p.longitude);
                return {
                  ...p,
                  distance_to_venue_km: Number(dist.toFixed(2)),
                  distance_km: Number(dist.toFixed(2)),
                };
              })
              .filter((p): p is NonNullable<typeof p> => p !== null && (p as any).distance_km <= searchRadiusKm)
              .sort((a, b) => (a as any).distance_km - (b as any).distance_km);
          } else {
            returnedProperties = mapped;
          }
        }
      } catch (err) {
        console.error('Error fetching real properties from Supabase for spatial search:', err);
      }
    }
  } else {
    // Fallback to memoryStore ONLY if Supabase is NOT configured or in DEMO mode
    let props = memoryStore.properties;
    if (hasCoordinates && venueLat !== null && venueLng !== null) {
      const nearbyProps = props
        .map((p) => {
          if (p.latitude === null || p.longitude === null) return null;
          const dist = haversineDistanceKm(venueLat, venueLng, p.latitude, p.longitude);
          return {
            ...p,
            venue: memoryStore.venues.find((v) => v.id === p.venue_id),
            distance_to_venue_km: Number(dist.toFixed(2)),
            distance_km: Number(dist.toFixed(2)),
          };
        })
        .filter((p): p is NonNullable<typeof p> => p !== null && (p as any).distance_km <= searchRadiusKm)
        .sort((a, b) => (a as any).distance_km - (b as any).distance_km);
      returnedProperties = nearbyProps.map(mapDbPropertyToAppProperty);
    } else if (venueId) {
      props = props.filter((p) => p.venue_id === venueId);
      returnedProperties = props.map((p) => mapDbPropertyToAppProperty({
        ...p,
        venue: memoryStore.venues.find((v) => v.id === p.venue_id),
      }));
    } else {
      returnedProperties = props.map((p) => mapDbPropertyToAppProperty({
        ...p,
        venue: memoryStore.venues.find((v) => v.id === p.venue_id),
      }));
    }
  }

  // 3. LOGGING DEBUG INFO
  const latDisplay = venueLat !== null && venueLat !== undefined ? venueLat : 'VENUE COORDINATES MISSING';
  const lngDisplay = venueLng !== null && venueLng !== undefined ? venueLng : 'VENUE COORDINATES MISSING';

  console.group('THEARKROOMS SEARCH DEBUG');
  console.log('Venue:');
  console.log('  Venue ID:', venueId || 'None selected');
  console.log('  Venue Name:', venue?.name || 'Unknown Venue');
  console.log('  Latitude:', latDisplay);
  console.log('  Longitude:', lngDisplay);
  console.log('\nDates:');
  console.log('  Check-in:', checkIn || 'Not specified');
  console.log('  Check-out:', checkOut || 'Not specified');
  console.log('\nGuests:', guests);
  console.log('\nSearch Radius:', `${searchRadiusKm} km`);
  console.log('\nRPC:', rpcName);
  console.log('  Parameters:', rpcParams);
  console.log('  Response:', rpcData);
  console.log('  RPC Error:', rpcError ? (rpcError.message || JSON.stringify(rpcError)) : 'None');
  console.log('\nRPC Result Count:', returnedProperties.length);

  // 4. DATABASE DIAGNOSTICS & ROOM PRICE/CAPACITY DECORATION
  let allProperties: Property[] = [];
  let allRooms: Room[] = [];
  let overlappingBookings: any[] = [];

  if (isSupabaseConfigured() && !isDemoMode()) {
    try {
      const { data: pData, error: pErr } = await withTimeout(supabase.from('properties').select('*') as unknown as Promise<any>, 3000);
      if (pErr) console.error('[SUPABASE] Diagnostics properties query error:', pErr);
      if (pData) allProperties = pData.map(mapDbPropertyToAppProperty);

      const { data: rData, error: rErr } = await withTimeout(supabase.from('rooms').select('*') as unknown as Promise<any>, 3000);
      if (rErr) console.error('[SUPABASE] Diagnostics rooms query error:', rErr);
      if (rData) allRooms = rData.map(mapDbRoomToAppRoom);

      if (checkIn && checkOut) {
        const { data: bData, error: bErr } = await withTimeout(
          supabase
            .from('bookings')
            .select('id, room_id, property_id, check_in, check_out, booking_status, payment_status, expires_at')
            .lt('check_in', checkOut)
            .gt('check_out', checkIn)
            .not('booking_status', 'in', '("cancelled","rejected","refunded")') as unknown as Promise<any>,
          3000
        );
        if (!bErr && bData && Array.isArray(bData)) {
          overlappingBookings = bData;
        }
      }
    } catch (e) {
      console.error('[SUPABASE] Diagnostics query exception:', e);
    }
  } else {
    allProperties = memoryStore.properties.map(mapDbPropertyToAppProperty);
    allRooms = memoryStore.rooms.map(mapDbRoomToAppRoom);
    if (checkIn && checkOut) {
      const nowMs = Date.now();
      overlappingBookings = memoryStore.bookings.filter((b) => {
        const bStatus = (b as any).booking_status || (b as any).status;
        const isCancelled = bStatus === 'cancelled' || bStatus === 'rejected' || bStatus === 'refunded';
        if (isCancelled) return false;
        if (bStatus === 'pending' && b.expires_at && new Date(b.expires_at).getTime() <= nowMs) {
          return false;
        }
        return b.check_in < checkOut && b.check_out > checkIn;
      });
    }
  }

  const propsWithLat = allProperties.filter((p) => p.latitude !== null && p.latitude !== undefined);
  const propsWithLng = allProperties.filter((p) => p.longitude !== null && p.longitude !== undefined);
  const propsWithBoth = allProperties.filter(
    (p) => p.latitude !== null && p.latitude !== undefined && p.longitude !== null && p.longitude !== undefined
  );
  const activeRooms = allRooms.filter((r) => r.available_count > 0);
  const roomsWithInventory = allRooms.filter((r) => r.available_count > 0);
  const roomsForGuestCount = allRooms.filter((r) => (r.capacity ?? 1) >= guests);

  console.groupEnd();

  const allPropertyDiagnostics: PropertyDiagnosticItem[] = allProperties.map((p) => {
    let distanceKm: number | null = null;
    let withinRadius = false;
    if (
      p.latitude !== null &&
      p.latitude !== undefined &&
      p.longitude !== null &&
      p.longitude !== undefined &&
      venueLat !== null &&
      venueLng !== null
    ) {
      const dist = haversineDistanceKm(venueLat, venueLng, p.latitude, p.longitude);
      distanceKm = Number(dist.toFixed(2));
      withinRadius = distanceKm <= searchRadiusKm;
    }
    return {
      id: p.id,
      name: p.title,
      propertyType: p.property_type || 'Hotel',
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      distanceKm,
      withinRadius,
    };
  });

  const rpcMatches: RpcMatchItem[] = returnedProperties.map((p) => {
    let dist: number | null = (p as any).distance_to_venue_km ?? (p as any).distance_km ?? null;
    if (dist === null && p.latitude && p.longitude && venueLat !== null && venueLng !== null) {
      dist = Number(haversineDistanceKm(venueLat, venueLng, p.latitude, p.longitude).toFixed(2));
    }
    return {
      id: p.id,
      name: p.title,
      distanceKm: dist,
    };
  });

  const diagnosticsData: SearchDiagnosticData = {
    venue,
    venueId,
    venueName: venue?.name || 'Unknown Venue',
    venueLat,
    venueLng,
    checkIn: checkIn || '',
    checkOut: checkOut || '',
    guests,
    searchRadiusKm,
    rpcFunction: rpcName,
    rpcParams: rpcParams as any,
    rpcStatus: rpcError ? 'ERROR' : 'SUCCESS',
    propertiesReturnedCount: returnedProperties.length,
    rpcError: rpcError ? (rpcError.message || String(rpcError)) : null,
    totalProperties: allProperties.length,
    propertiesWithLat: propsWithLat.length,
    propertiesWithLng: propsWithLng.length,
    propertiesWithBoth: propsWithBoth.length,
    totalRooms: allRooms.length,
    activeRooms: activeRooms.length,
    roomsWithInventory: roomsWithInventory.length,
    roomsForGuestCount: roomsForGuestCount.length,
    allPropertyDiagnostics,
    rpcMatches,
  };

  const isMatchingPropertyId = (roomIdOrPropId: string, targetPropId: string) => {
    return (
      roomIdOrPropId === targetPropId ||
      sanitizeToUuid(roomIdOrPropId) === sanitizeToUuid(targetPropId)
    );
  };

  const decoratedProperties: Property[] = returnedProperties.map((p) => {
    const propRooms = allRooms.filter((r) => isMatchingPropertyId(r.property_id, p.id));
    
    // Evaluate each room for the specific dates, capacity, and active status
    const nowMs = Date.now();
    const evaluatedRooms = propRooms.map((r) => {
      const roomBookings = overlappingBookings.filter((b) => {
        const matchesRoom = b.room_id === r.id || sanitizeToUuid(b.room_id) === sanitizeToUuid(r.id);
        if (!matchesRoom) return false;
        const bStatus = b.booking_status || b.status;
        if (bStatus === 'cancelled' || bStatus === 'rejected' || bStatus === 'refunded') return false;
        if (bStatus === 'pending' && b.expires_at && new Date(b.expires_at).getTime() <= nowMs) return false;
        return true;
      });
      const isRoomActive =
        r.is_active !== false &&
        r.status !== 'maintenance' &&
        r.status !== 'inactive' &&
        r.status !== 'sold_out' &&
        r.status !== false;
      const physicalCapacity = Number(r.total_rooms ?? r.available_count ?? 1);
      const availableForDates = !isRoomActive
        ? 0
        : Math.max(0, physicalCapacity - roomBookings.length);
      const meetsCapacity = (r.capacity ?? 1) >= guests;
      const isAvailable = isRoomActive && meetsCapacity && availableForDates > 0;
      return {
        ...r,
        available_count_for_dates: availableForDates,
        is_available_for_dates: isAvailable,
      };
    });

    const qualifyingRooms = evaluatedRooms.filter((r) => r.is_available_for_dates);
    const hasAvailability = qualifyingRooms.length > 0;
    const isSoldOut = !hasAvailability;
    const availableRoomsCount = qualifyingRooms.reduce(
      (sum, r) => sum + (r.available_count_for_dates ?? 1),
      0
    );

    const prices = (qualifyingRooms.length > 0 ? qualifyingRooms : propRooms).map((r) => r.price_per_night);
    const minPrice = prices.length > 0 ? Math.min(...prices) : (p.min_price || 75000);
    const availableRoomSample = qualifyingRooms.length > 0 ? qualifyingRooms[0].name : undefined;
    const availableRoomNames = qualifyingRooms.map((r) => r.name);

    let dist = p.distance_to_venue_km ?? (p as any).distance_km ?? null;
    if (dist === null && p.latitude && p.longitude && venueLat !== null && venueLng !== null) {
      dist = Number(haversineDistanceKm(venueLat, venueLng, p.latitude, p.longitude).toFixed(2));
    }

    return {
      ...p,
      min_price: minPrice,
      distance_to_venue_km: dist,
      distance_km: dist,
      has_availability: hasAvailability,
      is_sold_out: isSoldOut,
      available_rooms_count: availableRoomsCount,
      qualifying_rooms_count: qualifyingRooms.length,
      available_room_sample: availableRoomSample,
      available_room_names: availableRoomNames,
    };
  });

  // Prioritize available properties first, sorted by closest distance to venue
  const availableProperties = decoratedProperties
    .filter((p) => !p.is_sold_out)
    .sort((a, b) => (a.distance_to_venue_km ?? 9999) - (b.distance_to_venue_km ?? 9999));

  const soldOutProperties = decoratedProperties
    .filter((p) => p.is_sold_out)
    .sort((a, b) => (a.distance_to_venue_km ?? 9999) - (b.distance_to_venue_km ?? 9999));

  const sortedProperties = [...availableProperties, ...soldOutProperties];

  return {
    properties: sortedProperties,
    venue,
    diagnostics: diagnosticsData,
  };
}

export async function getPropertyById(
  propertyId: string,
  venueId?: string,
  checkIn?: string,
  checkOut?: string,
  guests?: number
): Promise<{ property: Property; rooms: Room[] } | null> {
  const sanitizedPropId = sanitizeToUuid(propertyId) || propertyId;
  const guestCount = guests && guests > 0 ? guests : 1;

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data: prop, error: propErr } = await withTimeout(
      supabase
        .from('properties')
        .select('*')
        .eq('id', sanitizedPropId)
        .maybeSingle(),
      10000,
      'Property lookup timed out'
    );

    if (propErr) {
      console.error('[SUPABASE] getPropertyById error:', propErr.message, propErr);
      throw new Error(`Failed to load property: ${propErr.message}`);
    }
    if (!prop) {
      return null;
    }

    const { data: rData, error: roomsErr } = await withTimeout(
      supabase
        .from('rooms')
        .select('*')
        .eq('property_id', sanitizedPropId),
      10000,
      'Property rooms lookup timed out'
    );

    if (roomsErr) {
      console.error('[SUPABASE] getPropertyById rooms error:', roomsErr.message, roomsErr);
      throw new Error(`Failed to load rooms for property: ${roomsErr.message}`);
    }

    let overlappingBookings: any[] = [];
    if (checkIn && checkOut) {
      try {
        const { data: bData } = await withTimeout(
          supabase
            .from('bookings')
            .select('id, room_id, property_id, check_in, check_out, booking_status, payment_status, expires_at')
            .eq('property_id', sanitizedPropId)
            .lt('check_in', checkOut)
            .gt('check_out', checkIn)
            .not('booking_status', 'in', '("cancelled","rejected","refunded")') as unknown as Promise<any>,
          3000
        );
        if (bData && Array.isArray(bData)) {
          overlappingBookings = bData;
        }
      } catch (bErr) {
        console.warn('[SUPABASE] getPropertyById bookings lookup warning:', bErr);
      }
    }

    const rawRooms = (rData || []).map(mapDbRoomToAppRoom);
    const nowMs = Date.now();
    const rooms = rawRooms.map((r) => {
      const roomBookings = overlappingBookings.filter((b) => {
        const matchesRoom = b.room_id === r.id || sanitizeToUuid(b.room_id) === sanitizeToUuid(r.id);
        if (!matchesRoom) return false;
        const bStatus = b.booking_status || b.status;
        if (bStatus === 'cancelled' || bStatus === 'rejected' || bStatus === 'refunded') return false;
        if (bStatus === 'pending' && b.expires_at && new Date(b.expires_at).getTime() <= nowMs) return false;
        return true;
      });
      const isRoomActive =
        r.is_active !== false &&
        r.status !== 'maintenance' &&
        r.status !== 'inactive' &&
        r.status !== 'sold_out' &&
        r.status !== false;
      const physicalCapacity = Number(r.total_rooms ?? r.available_count ?? 1);
      const availableForDates = !isRoomActive
        ? 0
        : Math.max(0, physicalCapacity - roomBookings.length);
      const meetsCapacity = (r.capacity ?? 1) >= guestCount;
      const isAvailable = isRoomActive && meetsCapacity && availableForDates > 0;
      return {
        ...r,
        available_count: availableForDates,
        available_count_for_dates: availableForDates,
        is_available_for_dates: isAvailable,
      };
    });

    let mappedProp = mapDbPropertyToAppProperty(prop);
    const qualifyingRooms = rooms.filter((r) => r.is_available_for_dates);
    const hasAvailability = qualifyingRooms.length > 0;
    const isSoldOut = !hasAvailability;
    const availableRoomsCount = qualifyingRooms.reduce(
      (sum, r) => sum + (r.available_count_for_dates ?? 1),
      0
    );

    const targetVenueId = venueId || prop.venue_id;
    if (targetVenueId) {
      try {
        const venue = await getVenueById(targetVenueId);
        if (venue) {
          let dist = mappedProp.distance_to_venue_km;
          if (
            (dist === null || dist === undefined) &&
            venue.latitude !== null &&
            venue.longitude !== null &&
            mappedProp.latitude !== null &&
            mappedProp.longitude !== null
          ) {
            dist = Number(haversineDistanceKm(venue.latitude, venue.longitude, mappedProp.latitude, mappedProp.longitude).toFixed(2));
          }
          mappedProp = {
            ...mappedProp,
            venue,
            venue_id: venue.id,
            distance_to_venue_km: dist,
            distance_km: dist,
          };
        }
      } catch (vCatch) {
        console.warn('[SUPABASE] getPropertyById venue lookup warning:', vCatch);
      }
    }

    mappedProp = {
      ...mappedProp,
      has_availability: hasAvailability,
      is_sold_out: isSoldOut,
      available_rooms_count: availableRoomsCount,
      qualifying_rooms_count: qualifyingRooms.length,
    };

    return {
      property: mappedProp,
      rooms,
    };
  }

  const prop = memoryStore.properties.find((p) => p.id === propertyId || p.id === sanitizedPropId);
  if (!prop) return null;

  const targetVenueId = venueId || prop.venue_id;
  const venue = targetVenueId ? memoryStore.venues.find((v) => v.id === targetVenueId || v.id === sanitizeToUuid(targetVenueId)) : undefined;

  let overlappingBookings: any[] = [];
  const nowMs = Date.now();
  if (checkIn && checkOut) {
    overlappingBookings = memoryStore.bookings.filter((b) => {
      const bStatus = (b as any).booking_status || (b as any).status;
      const isCancelled = bStatus === 'cancelled' || bStatus === 'rejected' || bStatus === 'refunded';
      if (isCancelled) return false;
      if (bStatus === 'pending' && b.expires_at && new Date(b.expires_at).getTime() <= nowMs) return false;
      const isMatchingProp = b.property_id === propertyId || b.property_id === sanitizedPropId;
      return isMatchingProp && b.check_in < checkOut && b.check_out > checkIn;
    });
  }

  const rawRooms = memoryStore.rooms
    .filter((r) => r.property_id === propertyId || r.property_id === sanitizedPropId)
    .map(mapDbRoomToAppRoom);

  const rooms = rawRooms.map((r) => {
    const roomBookings = overlappingBookings.filter((b) => {
      const matchesRoom = b.room_id === r.id || sanitizeToUuid(b.room_id) === sanitizeToUuid(r.id);
      if (!matchesRoom) return false;
      const bStatus = b.booking_status || b.status;
      if (bStatus === 'cancelled' || bStatus === 'rejected' || bStatus === 'refunded') return false;
      if (bStatus === 'pending' && b.expires_at && new Date(b.expires_at).getTime() <= nowMs) return false;
      return true;
    });
    const isRoomActive =
      r.is_active !== false &&
      r.status !== 'maintenance' &&
      r.status !== 'inactive' &&
      r.status !== 'sold_out' &&
      r.status !== false;
    const physicalCapacity = Number(r.total_rooms ?? r.available_count ?? 1);
    const availableForDates = !isRoomActive
      ? 0
      : Math.max(0, physicalCapacity - roomBookings.length);
    const meetsCapacity = (r.capacity ?? 1) >= guestCount;
    const isAvailable = isRoomActive && meetsCapacity && availableForDates > 0;
    return {
      ...r,
      available_count: availableForDates,
      available_count_for_dates: availableForDates,
      is_available_for_dates: isAvailable,
    };
  });

  const qualifyingRooms = rooms.filter((r) => r.is_available_for_dates);
  const hasAvailability = qualifyingRooms.length > 0;
  const isSoldOut = !hasAvailability;
  const availableRoomsCount = qualifyingRooms.reduce(
    (sum, r) => sum + (r.available_count_for_dates ?? 1),
    0
  );

  return {
    property: mapDbPropertyToAppProperty({
      ...prop,
      venue,
      has_availability: hasAvailability,
      is_sold_out: isSoldOut,
      available_rooms_count: availableRoomsCount,
      qualifying_rooms_count: qualifyingRooms.length,
    }),
    rooms,
  };
}

export async function getRoomById(roomId: string): Promise<Room | null> {
  const sanitizedRoomId = sanitizeToUuid(roomId) || roomId;
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await withTimeout(
      supabase.from('rooms').select('*').eq('id', sanitizedRoomId).maybeSingle(),
      10000,
      'Room lookup timed out'
    );
    if (error) {
      console.error('[SUPABASE] getRoomById error:', error.message, error);
      throw new Error(`Failed to load room: ${error.message}`);
    }
    return data ? mapDbRoomToAppRoom(data) : null;
  }
  const mockRoom = memoryStore.rooms.find((r) => r.id === roomId || r.id === sanitizedRoomId);
  return mockRoom ? mapDbRoomToAppRoom(mockRoom) : null;
}

export interface CreateBookingPayload {
  user_id?: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  country: string;
  passport_name?: string;
  special_requests?: string;
  property_id: string;
  room_id: string;
  venue_id?: string;
  check_in: string;
  check_out: string;
  guests: number;
  logisticsServices?: SelectedLogisticsService[];
  logistics?: {
    type: LogisticsType;
    priceNGN?: number | null;
    price_ngn?: number | null;
    amount?: number | null;
    vehicle_preference?: string;
    airport?: string;
    arrival_date?: string;
    arrival_time?: string;
    flight_number?: string;
    departure_date?: string;
    departure_time?: string;
    departure_flight_number?: string;
    passengers?: number;
    pickup_location?: string;
    dropoff_location?: string;
    notes?: string;
  };
}

export async function createPendingBookingWithLogistics(payload: CreateBookingPayload): Promise<{
  booking: Booking;
  logisticsRequests: LogisticsRequest[];
}> {
  // 1. SUPABASE PATH: Atomic Transaction via PostgreSQL RPC
  if (isSupabaseConfigured()) {
    // A. Verify authenticated Supabase session
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const authUser = session?.user;
    if (!session || !authUser) {
      throw new Error('Authentication required: You must be signed in to complete your reservation.');
    }

    // B. Sanitize and validate required UUIDs
    const sanitizedPropertyId = sanitizeToUuid(payload.property_id);
    const sanitizedRoomId = sanitizeToUuid(payload.room_id);
    if (!sanitizedPropertyId || !sanitizedRoomId) {
      throw new Error('Invalid property or room selection. Please re-select your room option and try again.');
    }

    // C. Fetch property and room for constructing the returned application object
    const propRes = await getPropertyById(payload.property_id);
    const property = propRes?.property;
    const room = await getRoomById(payload.room_id);

    // D. Build normalized, guaranteed JSON-safe array of plain objects
    const normalizedServices = payload.logisticsServices || (payload.logistics && payload.logistics.type !== 'no_transfer' ? [payload.logistics] : []);
    const VALID_LOGISTICS_TYPES = new Set([
      'airport_pickup',
      'airport_dropoff',
      'car_rental',
      'private_driver',
      'vip_transport',
    ]);

    const normalizeServiceType = (rawType: any): string => {
      if (typeof rawType !== 'string') return 'airport_pickup';
      const raw = rawType.trim().toLowerCase();
      if (VALID_LOGISTICS_TYPES.has(raw)) return raw;
      if (raw === 'around_town') return 'car_rental';
      if (raw === 'event_transport' || raw === 'event_shuttle') return 'vip_transport';
      if (raw === 'airport_transfer' || raw === 'both_airport_transfer') return 'airport_pickup';
      return 'airport_pickup';
    };

    const cleanLogisticsServices = Array.isArray(normalizedServices)
      ? normalizedServices.map((service: any) => ({
          type: normalizeServiceType(service?.type),
          priceNGN: Number.isFinite(Number(service?.priceNGN)) ? Number(service.priceNGN) : 0,
          pickup_location:
            typeof service?.pickup_location === 'string' && service.pickup_location.trim()
              ? service.pickup_location.trim()
              : null,
          dropoff_location:
            typeof service?.dropoff_location === 'string' && service.dropoff_location.trim()
              ? service.dropoff_location.trim()
              : null,
          arrival_date:
            typeof service?.arrival_date === 'string' && service.arrival_date.trim()
              ? service.arrival_date.trim()
              : null,
          arrival_time:
            typeof service?.arrival_time === 'string' && service.arrival_time.trim()
              ? service.arrival_time.trim()
              : null,
          pickup_date:
            typeof service?.pickup_date === 'string' && service.pickup_date.trim()
              ? service.pickup_date.trim()
              : typeof service?.start_date === 'string' && service.start_date.trim()
                ? service.start_date.trim()
                : typeof service?.transport_date === 'string' && service.transport_date.trim()
                  ? service.transport_date.trim()
                  : null,
          pickup_time:
            typeof service?.pickup_time === 'string' && service.pickup_time.trim()
              ? service.pickup_time.trim()
              : null,
          airport:
            typeof service?.airport === 'string' && service.airport.trim()
              ? service.airport.trim()
              : null,
          flight_number:
            typeof service?.flight_number === 'string' && service.flight_number.trim()
              ? service.flight_number.trim()
              : null,
          departure_flight_number:
            typeof service?.departure_flight_number === 'string' && service.departure_flight_number.trim()
              ? service.departure_flight_number.trim()
              : null,
          vehicle_preference:
            typeof service?.vehicle_preference === 'string' && service.vehicle_preference.trim()
              ? service.vehicle_preference.trim()
              : null,
          requirement_type:
            typeof service?.requirement_type === 'string' && service.requirement_type.trim()
              ? service.requirement_type.trim()
              : null,
          notes:
            typeof service?.notes === 'string' && service.notes.trim()
              ? service.notes.trim()
              : null,
        }))
      : [];

    // Exact serialization and validation boundary
    const finalLogisticsPayload = cleanLogisticsServices.map((service: any) => ({
      type: String(service?.type ?? ''),
      priceNGN: Number(service?.priceNGN ?? 0),
      pickup_location: service?.pickup_location == null ? null : String(service.pickup_location),
      dropoff_location: service?.dropoff_location == null ? null : String(service.dropoff_location),
      arrival_date: service?.arrival_date == null ? null : String(service.arrival_date),
      arrival_time: service?.arrival_time == null ? null : String(service.arrival_time),
      pickup_date: service?.pickup_date == null ? null : String(service.pickup_date),
      pickup_time: service?.pickup_time == null ? null : String(service.pickup_time),
      airport: service?.airport == null ? null : String(service.airport),
      flight_number: service?.flight_number == null ? null : String(service.flight_number),
      departure_flight_number:
        service?.departure_flight_number == null
          ? null
          : String(service.departure_flight_number),
      vehicle_preference:
        service?.vehicle_preference == null
          ? null
          : String(service.vehicle_preference),
      requirement_type:
        service?.requirement_type == null
          ? null
          : String(service.requirement_type),
      notes: service?.notes == null ? null : String(service.notes),
    }));

    const finalLogisticsJson = JSON.stringify(finalLogisticsPayload);
    // Prove that this is valid JSON before sending it
    const parsedLogisticsPayload = JSON.parse(finalLogisticsJson);
    if (!Array.isArray(parsedLogisticsPayload)) {
      throw new Error('Logistics serialization failed to produce a valid array.');
    }

    // E. Generate Unique Booking Reference
    const randChars = Math.random().toString(36).substring(2, 7).toUpperCase();
    const year = new Date().getFullYear();
    const bookingReference = `ARK-${year}-${randChars}`;

    // F. Call atomic PostgreSQL RPC
    const { data, error } = await supabase.rpc(
      'create_pending_booking_transaction',
      {
        p_property_id: sanitizedPropertyId,
        p_room_id: sanitizedRoomId,
        p_check_in: payload.check_in,
        p_check_out: payload.check_out,
        p_guests: payload.guests,
        p_guest_first_name: payload.guest_first_name,
        p_guest_last_name: payload.guest_last_name,
        p_guest_email: payload.guest_email,
        p_guest_phone: payload.guest_phone,
        p_country: payload.country || 'Nigeria',
        p_passport_name: payload.passport_name || '',
        p_special_requests: payload.special_requests || '',
        p_booking_reference: bookingReference,
        p_logistics_services: parsedLogisticsPayload,
      }
    );

    if (error) {
      console.error('[RPC Error]', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      const message = error.message || '';
      if (
        message.toLowerCase().includes('sold out') ||
        message.toLowerCase().includes('no longer available') ||
        message.toLowerCase().includes('inventory')
      ) {
        throw new Error('This room was just booked by another attendee. Please choose another available room.');
      }
      throw new Error(
        `[${error.code || 'RPC_ERROR'}] ${error.message}${
          error.details ? ` | ${error.details}` : ''
        }`
      );
    }

    if (!data) {
      throw new Error('We could not create your reservation. Please try again.');
    }

    const createdBookingId = data?.booking_id || data?.booking?.id || data?.id || (typeof data === 'string' && /^[0-9a-f-]{36}$/i.test(data) ? data : undefined);
    if (!createdBookingId) {
      throw new Error('Booking transaction succeeded but no booking ID was returned.');
    }

    // G. Retrieve created logistics records safely without blocking or throwing if table fetch fails
    let returnedLogistics: LogisticsRequest[] = [];
    try {
      const { data: logisticsData, error: logisticsError } = await supabase
        .from('logistics_requests')
        .select('*')
        .eq('booking_id', createdBookingId)
        .order('created_at', { ascending: true });

      if (!logisticsError && Array.isArray(logisticsData) && logisticsData.length > 0) {
        returnedLogistics = logisticsData.map((item: any) => ({
          id: item.id,
          user_id: item.user_id,
          booking_id: item.booking_id,
          type: (item.service_type || item.type || 'airport_pickup') as any,
          service_name: item.service_type
            ? String(item.service_type).replace(/_/g, ' ').toUpperCase()
            : (item.service_name || 'Logistics Service'),
          airport: item.airport,
          arrival_date: item.pickup_date || item.arrival_date,
          arrival_time: item.pickup_time || item.arrival_time,
          flight_number: item.flight_number,
          departure_date: item.departure_date,
          departure_time: item.departure_time,
          departure_flight_number: item.departure_flight_number,
          pickup_location: item.pickup_location || 'Airport / Hotel',
          dropoff_location: item.dropoff_location || 'Event Venue',
          request_date: item.pickup_date || item.request_date,
          request_time: item.pickup_time || item.request_time,
          passengers: Number(item.passengers || 1),
          status: item.status === 'requested' ? 'pending' : (item.status as any),
          amount: Number(item.price_ngn ?? item.amount ?? 0),
          notes: item.notes || '',
          created_at: item.created_at || new Date().toISOString(),
        }));
      } else if (cleanLogisticsServices.length > 0) {
        // Fallback to local clean logistics representation so confirmation displays immediately
        returnedLogistics = cleanLogisticsServices.map((service: any, index: number) => ({
          id: `temp-logistics-${createdBookingId}-${index}`,
          user_id: authUser.id,
          booking_id: createdBookingId,
          type: service.type,
          service_name: String(service.type).replace(/_/g, ' ').toUpperCase(),
          airport: service.airport || service.pickup_location,
          arrival_date: service.arrival_date || service.pickup_date,
          arrival_time: service.arrival_time || service.pickup_time,
          flight_number: service.flight_number,
          departure_date: service.departure_date,
          departure_time: service.departure_time,
          departure_flight_number: service.departure_flight_number,
          pickup_location: service.pickup_location || service.airport || 'Pickup Location',
          dropoff_location: service.dropoff_location || 'Event Venue',
          request_date: service.pickup_date || service.arrival_date,
          request_time: service.pickup_time || service.arrival_time,
          passengers: Number(payload.guests || 1),
          status: 'pending',
          amount: Number(service.priceNGN || 0),
          notes: service.notes || '',
          created_at: new Date().toISOString(),
        }));
      }
    } catch (logisticsFetchErr) {
      console.warn('[Logistics Fetch Non-blocking Warning]', logisticsFetchErr);
      returnedLogistics = cleanLogisticsServices.map((service: any, index: number) => ({
        id: `temp-logistics-${createdBookingId}-${index}`,
        user_id: authUser.id,
        booking_id: createdBookingId,
        type: service.type,
        service_name: String(service.type).replace(/_/g, ' ').toUpperCase(),
        airport: service.airport || service.pickup_location,
        arrival_date: service.arrival_date || service.pickup_date,
        arrival_time: service.arrival_time || service.pickup_time,
        flight_number: service.flight_number,
        departure_date: service.departure_date,
        departure_time: service.departure_time,
        departure_flight_number: service.departure_flight_number,
        pickup_location: service.pickup_location || service.airport || 'Pickup Location',
        dropoff_location: service.dropoff_location || 'Event Venue',
        request_date: service.pickup_date || service.arrival_date,
        request_time: service.pickup_time || service.arrival_time,
        passengers: Number(payload.guests || 1),
        status: 'pending',
        amount: Number(service.priceNGN || 0),
        notes: service.notes || '',
        created_at: new Date().toISOString(),
      }));
    }

    const nights = Math.max(
      1,
      Math.ceil((new Date(payload.check_out).getTime() - new Date(payload.check_in).getTime()) / (1000 * 3600 * 24))
    );

    const accommodationSubtotal = Number(
      data?.accommodation_total_ngn ??
      data?.booking?.room_total_ngn ??
      (room ? room.price_per_night * nights : 0)
    );
    const logisticsSubtotal = Number(
      data?.logistics_total_ngn ??
      data?.booking?.logistics_total_ngn ??
      cleanLogisticsServices.reduce((sum: number, s: any) => sum + (Number(s.priceNGN) || 0), 0)
    );
    const totalAmount = Number(
      data?.total_amount_ngn ??
      data?.booking?.total_amount_ngn ??
      (accommodationSubtotal + logisticsSubtotal)
    );

    const returnedBooking: Booking = {
      id: createdBookingId,
      booking_reference: data?.booking_reference || data?.booking?.booking_reference || (typeof data === 'object' && data?.reference) || bookingReference,
      user_id: data?.user_id || data?.booking?.user_id || authUser.id,
      property_id: sanitizedPropertyId,
      room_id: sanitizedRoomId,
      venue_id: property?.venue_id || payload.venue_id || '',
      guest_first_name: payload.guest_first_name,
      guest_last_name: payload.guest_last_name,
      guest_email: payload.guest_email,
      guest_phone: payload.guest_phone,
      country: payload.country || 'Nigeria',
      passport_name: payload.passport_name || '',
      special_requests: payload.special_requests || '',
      check_in: payload.check_in,
      check_out: payload.check_out,
      nights,
      guests: payload.guests,
      accommodation_subtotal: accommodationSubtotal,
      logistics_subtotal: logisticsSubtotal,
      total_amount: totalAmount,
      damage_deposit_ngn: Number(data?.damage_deposit_ngn ?? data?.booking?.damage_deposit_ngn ?? 0),
      currency: 'NGN',
      status: 'pending_payment',
      payment_status: 'unpaid',
      expires_at: data?.expires_at || data?.booking?.expires_at || undefined,
      created_at: data?.created_at || data?.booking?.created_at || new Date().toISOString(),
      property: property || undefined,
      room: room || undefined,
      venue: property?.venue || undefined,
    };

    return {
      booking: returnedBooking,
      logisticsRequests: returnedLogistics,
    };
  }

  // 2. LOCAL FALLBACK PATH (When Supabase is NOT configured)
  const propRes = await getPropertyById(payload.property_id);
  if (!propRes || !propRes.property) {
    throw new Error('Property listing could not be verified in our database records.');
  }
  const property = propRes.property;
  const room = await getRoomById(payload.room_id);
  if (!room) {
    throw new Error('Selected room option is no longer available in our inventory.');
  }

  const nights = Math.max(
    1,
    Math.ceil((new Date(payload.check_out).getTime() - new Date(payload.check_in).getTime()) / (1000 * 3600 * 24))
  );
  const accommodationSubtotal = room.price_per_night * nights;

  let servicesToProcess: SelectedLogisticsService[] = payload.logisticsServices || [];
  if (servicesToProcess.length === 0 && payload.logistics && payload.logistics.type !== 'no_transfer') {
    let price: number | null = payload.logistics.priceNGN ?? payload.logistics.price_ngn ?? payload.logistics.amount;
    if (price === undefined || price === null || isNaN(price)) {
      if (payload.logistics.type === 'both_airport_transfer') price = 65000;
      else if (payload.logistics.type === 'event_shuttle') price = 20000;
      else if (payload.logistics.type === 'car_rental') price = 50000;
      else price = 25000;
    }

    servicesToProcess = [
      {
        type: payload.logistics.type,
        title: payload.logistics.vehicle_preference
          ? `Airport Chauffeur (${payload.logistics.vehicle_preference})`
          : payload.logistics.type.replace(/_/g, ' ').toUpperCase(),
        priceNGN: price,
        vehicle_preference: payload.logistics.vehicle_preference,
        airport: payload.logistics.airport,
        arrival_date: payload.logistics.arrival_date,
        arrival_time: payload.logistics.arrival_time,
        flight_number: payload.logistics.flight_number,
        departure_date: payload.logistics.departure_date,
        departure_time: payload.logistics.departure_time,
        departure_flight_number: payload.logistics.departure_flight_number,
        passengers: payload.logistics.passengers,
        pickup_location: payload.logistics.pickup_location,
        dropoff_location: payload.logistics.dropoff_location,
        notes: payload.logistics.notes,
      },
    ];
  }

  const logisticsSubtotal = servicesToProcess.reduce((sum, s) => {
    return sum + (typeof s.priceNGN === 'number' ? s.priceNGN : 0);
  }, 0);

  const grandTotal = accommodationSubtotal + logisticsSubtotal;
  const randChars = Math.random().toString(36).substring(2, 7).toUpperCase();
  const year = new Date().getFullYear();
  const bookingReference = `ARK-${year}-${randChars}`;
  const bookingId = `bk-${Date.now()}`;

  const savedBooking: Booking = {
    id: bookingId,
    booking_reference: bookingReference,
    user_id: payload.user_id || 'guest',
    property_id: payload.property_id,
    room_id: payload.room_id,
    venue_id: property.venue_id || payload.venue_id || '',
    guest_first_name: payload.guest_first_name,
    guest_last_name: payload.guest_last_name,
    guest_email: payload.guest_email,
    guest_phone: payload.guest_phone,
    country: payload.country,
    passport_name: payload.passport_name || '',
    special_requests: payload.special_requests || '',
    check_in: payload.check_in,
    check_out: payload.check_out,
    nights,
    guests: payload.guests,
    accommodation_subtotal: accommodationSubtotal,
    logistics_subtotal: logisticsSubtotal,
    room_total_ngn: accommodationSubtotal,
    logistics_total_ngn: logisticsSubtotal,
    total_amount_ngn: grandTotal,
    total_amount: grandTotal,
    damage_deposit_ngn: 0,
    currency: 'NGN',
    status: 'pending_payment',
    payment_status: 'unpaid',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    property,
    room,
    venue: property.venue || memoryStore.venues.find((v) => v.id === property.venue_id),
  };

  memoryStore.bookings.unshift(savedBooking);

  const createdLogisticsRequests: LogisticsRequest[] = [];
  const defaultAirport = 'Nnamdi Azikiwe International Airport, Abuja';

  for (let i = 0; i < servicesToProcess.length; i++) {
    const service = servicesToProcess[i];
    const logData: LogisticsRequest = {
      id: `log-${Date.now()}-${i}`,
      booking_id: savedBooking.id,
      user_id: payload.user_id || 'guest',
      type: service.type,
      service_name: service.vehicle_preference || service.title,
      vehicle_preference: service.vehicle_preference,
      airport: service.airport || defaultAirport,
      arrival_date: service.arrival_date || service.start_date || payload.check_in,
      arrival_time: service.arrival_time || service.pickup_time || '12:00',
      flight_number: service.flight_number || '',
      departure_date: service.departure_date || service.end_date || payload.check_out,
      departure_time: service.departure_time || '10:00',
      departure_flight_number: service.departure_flight_number || '',
      pickup_location: service.pickup_location || (service.type.includes('pickup') ? (service.airport || defaultAirport) : property.title),
      dropoff_location: service.dropoff_location || (service.type.includes('dropoff') ? (service.airport || defaultAirport) : (property.venue?.name || 'Event Venue')),
      request_date: service.start_date || service.arrival_date || payload.check_in,
      request_time: service.arrival_time || service.pickup_time || '08:00',
      passengers: service.passengers || payload.guests,
      status: 'pending',
      amount: typeof service.priceNGN === 'number' ? service.priceNGN : 0,
      price_ngn: typeof service.priceNGN === 'number' ? service.priceNGN : 0,
      notes: service.notes || '',
      created_at: new Date().toISOString(),
    };
    memoryStore.logistics.unshift(logData);
    createdLogisticsRequests.push(logData);
  }

  return {
    booking: savedBooking,
    logisticsRequests: createdLogisticsRequests,
  };
}

async function populateBookingRelations(data: any): Promise<Booking> {
  const mapped = mapDbBookingToAppBooking(data);
  if (!mapped.property && data.property_id) {
    try {
      const propRes = await withTimeout(
        getPropertyById(data.property_id, data.venue_id),
        10000,
        'Property resolution timed out'
      );
      if (propRes) mapped.property = propRes.property;
    } catch (pErr) {
      console.warn('[TRIP DETAIL] Property resolution fallback used:', pErr);
    }
  }
  if (!mapped.room && data.room_id) {
    try {
      const roomRes = await withTimeout(
        getRoomById(data.room_id),
        10000,
        'Room resolution timed out'
      );
      if (roomRes) mapped.room = roomRes;
    } catch (rErr) {
      console.warn('[TRIP DETAIL] Room resolution fallback used:', rErr);
    }
  }
  if (!mapped.venue && (data.venue_id || mapped.property?.venue_id)) {
    const targetVenueId = data.venue_id || mapped.property?.venue_id;
    if (targetVenueId) {
      try {
        const venueRes = await withTimeout(
          getVenueById(targetVenueId),
          10000,
          'Venue resolution timed out'
        );
        if (venueRes) mapped.venue = venueRes;
      } catch (vErr) {
        console.warn('[TRIP DETAIL] Venue resolution fallback used:', vErr);
      }
    }
  }
  return mapped;
}

export async function getBookingById(bookingId: string): Promise<Booking | null> {
  const cleanId = (bookingId || '').trim();
  if (!cleanId) return null;
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data: flatData, error: flatError } = await withTimeout(
      supabase.from('bookings').select('*').eq('id', cleanId).maybeSingle(),
      10000,
      'Supabase flat booking query timed out'
    );
    if (flatError) {
      console.error('[SUPABASE] getBookingById flat query error:', flatError.message, flatError);
      throw new Error(`Failed to load booking: ${flatError.message}`);
    }
    if (flatData) {
      return await populateBookingRelations(flatData);
    }
    const { data: joinedData, error: joinedError } = await withTimeout(
      supabase.from('bookings').select('*, property:properties(*), room:rooms(*)').eq('id', cleanId).maybeSingle(),
      10000,
      'Supabase joined booking query timed out'
    );
    if (joinedError) {
      console.error('[SUPABASE] getBookingById joined query error:', joinedError.message, joinedError);
      throw new Error(`Failed to load booking details: ${joinedError.message}`);
    }
    if (joinedData) {
      return await populateBookingRelations(joinedData);
    }
    return null;
  }
  const b = memoryStore.bookings.find((item) => item.id === cleanId);
  if (!b) return null;
  const property = memoryStore.properties.find((p) => p.id === b.property_id || p.id === sanitizeToUuid(b.property_id));
  const room = memoryStore.rooms.find((r) => r.id === b.room_id || r.id === sanitizeToUuid(b.room_id));
  const venue = memoryStore.venues.find((v) => v.id === b.venue_id || v.id === sanitizeToUuid(b.venue_id));
  return { ...b, property, room, venue };
}

export async function getBookingByReference(bookingReference: string): Promise<Booking | null> {
  const cleanRef = (bookingReference || '').trim();
  if (!cleanRef) return null;
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data: flatData, error: flatError } = await withTimeout(
      supabase.from('bookings').select('*').eq('booking_reference', cleanRef).maybeSingle(),
      10000,
      'Supabase flat booking reference query timed out'
    );
    if (flatError) {
      console.error('[SUPABASE] getBookingByReference flat query error:', flatError.message, flatError);
      throw new Error(`Failed to load booking by reference: ${flatError.message}`);
    }
    if (flatData) {
      return await populateBookingRelations(flatData);
    }
    const { data: joinedData, error: joinedError } = await withTimeout(
      supabase.from('bookings').select('*, property:properties(*), room:rooms(*)').eq('booking_reference', cleanRef).maybeSingle(),
      10000,
      'Supabase joined booking reference query timed out'
    );
    if (joinedError) {
      console.error('[SUPABASE] getBookingByReference joined query error:', joinedError.message, joinedError);
      throw new Error(`Failed to load booking details by reference: ${joinedError.message}`);
    }
    if (joinedData) {
      return await populateBookingRelations(joinedData);
    }
    return null;
  }
  const b = memoryStore.bookings.find((item) => item.booking_reference === cleanRef);
  if (!b) return null;
  const property = memoryStore.properties.find((p) => p.id === b.property_id || p.id === sanitizeToUuid(b.property_id));
  const room = memoryStore.rooms.find((r) => r.id === b.room_id || r.id === sanitizeToUuid(b.room_id));
  const venue = memoryStore.venues.find((v) => v.id === b.venue_id || v.id === sanitizeToUuid(b.venue_id));
  return { ...b, property, room, venue };
}

export async function getBookingByIdentifier(identifier: string): Promise<Booking | null> {
  const clean = (identifier || '').trim();
  if (!clean) return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean);
  if (isUuid) {
    const res = await getBookingById(clean);
    if (res) return res;
    return await getBookingByReference(clean);
  } else {
    const res = await getBookingByReference(clean);
    if (res) return res;
    return await getBookingById(clean);
  }
}

export async function createBooking(bookingData: Omit<Booking, 'id' | 'created_at'>): Promise<Booking> {
  const bookingRef =
    bookingData.booking_reference ||
    `ARK-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  let nights = bookingData.nights;
  if (!nights && bookingData.check_in && bookingData.check_out) {
    const diffTime = Math.abs(new Date(bookingData.check_out).getTime() - new Date(bookingData.check_in).getTime());
    nights = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }
  if (!nights) nights = 1;

  let roomTotalNgn = Number(
    bookingData.room_total_ngn ??
    bookingData.accommodation_subtotal ??
    0
  );
  let logisticsTotalNgn = Number(
    bookingData.logistics_total_ngn ??
    bookingData.logistics_subtotal ??
    0
  );
  let grandTotal = Number(
    bookingData.total_amount_ngn ??
    bookingData.total_amount ??
    (roomTotalNgn + logisticsTotalNgn)
  );

  if (grandTotal <= 0 && (roomTotalNgn > 0 || logisticsTotalNgn > 0)) {
    grandTotal = roomTotalNgn + logisticsTotalNgn;
  }

  if (grandTotal > 0 && roomTotalNgn === 0) {
    roomTotalNgn = Math.max(0, grandTotal - logisticsTotalNgn);
  }

  const newBooking: Booking = {
    ...bookingData,
    id: `bk-${Date.now()}`,
    booking_reference: bookingRef,
    nights,
    room_total_ngn: roomTotalNgn,
    logistics_total_ngn: logisticsTotalNgn,
    accommodation_subtotal: roomTotalNgn,
    logistics_subtotal: logisticsTotalNgn,
    total_amount: grandTotal,
    total_amount_ngn: grandTotal,
    created_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    const authUser = session?.user;

    if (!session || !authUser) {
      throw new Error('Authentication required: You must be signed in to create a booking reservation.');
    }

    if (!bookingData.property_id || !bookingData.room_id || !bookingData.check_in || !bookingData.check_out) {
      throw new Error(
        'Direct unverified booking insertion is prohibited. Valid property_id, room_id, check_in, and check_out are required for authoritative reservation.'
      );
    }

    // Direct browser insertion into the bookings table is deprecated and blocked for safety.
    // Force all bookings through createPendingBookingWithLogistics (authoritative RPC):
    const rpcResult = await createPendingBookingWithLogistics({
      user_id: authUser.id,
      property_id: bookingData.property_id,
      room_id: bookingData.room_id,
      check_in: bookingData.check_in,
      check_out: bookingData.check_out,
      guests: bookingData.guests || 1,
      guest_first_name: bookingData.guest_first_name || '',
      guest_last_name: bookingData.guest_last_name || '',
      guest_email: bookingData.guest_email || authUser.email || '',
      guest_phone: bookingData.guest_phone || '',
      country: (bookingData as any).country || 'Nigeria',
      passport_name: (bookingData as any).passport_name || '',
      special_requests: bookingData.special_requests || '',
      venue_id: (bookingData as any).venue_id,
      logisticsServices: (bookingData as any).logisticsServices || [],
      logistics: (bookingData as any).logistics,
    });

    return rpcResult.booking;
  }

  if (newBooking.has_logistics || (bookingData as any).logisticsServices?.length > 0) {
    const vPref = (bookingData as any).vehicle_preference || ((bookingData as any).logisticsServices?.[0]?.vehicle_preference) || 'Standard Executive Sedan';
    memoryStore.logistics.unshift({
      id: `log-${Date.now()}`,
      booking_id: newBooking.id,
      user_id: newBooking.user_id,
      type: 'airport_pickup',
      service_name: `Airport Chauffeur (${vPref})`,
      vehicle_preference: vPref,
      amount: logisticsTotalNgn,
      price_ngn: logisticsTotalNgn,
      flight_number: (bookingData as any).flight_number || (bookingData as any).logisticsServices?.[0]?.flight_number || '',
      arrival_date: (bookingData as any).arrival_date || newBooking.check_in,
      arrival_time: (bookingData as any).arrival_time || '12:00',
      pickup_location: 'Nnamdi Azikiwe International Airport (ABV)',
      dropoff_location: 'Event Stay',
      passengers: newBooking.guests || 1,
      status: 'pending',
      created_at: new Date().toISOString(),
    } as any);
  }

  memoryStore.bookings.unshift(newBooking);
  return newBooking;
}

export async function getUserBookings(userId?: string): Promise<Booking[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    let targetUserId = userId;
    if (!targetUserId || targetUserId === 'guest') {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.user?.id) {
        targetUserId = sessionData.session.user.id;
      }
    }
    if (!targetUserId) {
      return [];
    }

    let { data, error } = await supabase
      .from('bookings')
      .select('*, property:properties(*), room:rooms(*)')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      const flatRes = await supabase
        .from('bookings')
        .select('*')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: false });
      if (flatRes.error) {
        console.error('[SUPABASE] getUserBookings error:', flatRes.error.message, flatRes.error);
        throw new Error(`Failed to load user bookings: ${flatRes.error.message}`);
      }
      data = flatRes.data;
      error = null;
    }

    if (data) {
      const mappedList = await Promise.all(
        data.map(async (rawItem: any) => {
          const mapped = mapDbBookingToAppBooking(rawItem);
          if (!mapped.property && rawItem.property_id) {
            try {
              const propRes = await getPropertyById(rawItem.property_id, rawItem.venue_id);
              if (propRes) mapped.property = propRes.property;
            } catch (pErr) {
              console.warn('[SUPABASE] getUserBookings property resolution warning:', pErr);
            }
          }
          if (!mapped.room && rawItem.room_id) {
            try {
              const roomRes = await getRoomById(rawItem.room_id);
              if (roomRes) mapped.room = roomRes;
            } catch (rErr) {
              console.warn('[SUPABASE] getUserBookings room resolution warning:', rErr);
            }
          }
          return mapped;
        })
      );
      return mappedList;
    }
    return [];
  }
  const filterId = userId || 'guest';
  return memoryStore.bookings
    .filter((b) => !filterId || filterId === 'guest' || b.user_id === filterId)
    .map((b) => {
      const property = memoryStore.properties.find((p) => p.id === b.property_id);
      const room = memoryStore.rooms.find((r) => r.id === b.room_id);
      const venue = memoryStore.venues.find((v) => v.id === b.venue_id);
      return { ...b, property, room, venue };
    });
}

export async function getAllBookingsForAdmin(): Promise<Booking[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('bookings')
      .select('*, property:properties(*), room:rooms(*)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[SUPABASE] getAllBookingsForAdmin error:', error.message, error);
      throw new Error(`Failed to load bookings: ${error.message}`);
    }
    return data ? data.map(mapDbBookingToAppBooking) : [];
  }
  return memoryStore.bookings.map((b) => {
    const property = memoryStore.properties.find((p) => p.id === b.property_id);
    const room = memoryStore.rooms.find((r) => r.id === b.room_id);
    const venue = memoryStore.venues.find((v) => v.id === b.venue_id);
    return { ...b, property, room, venue };
  });
}

export async function getAllPaymentsForAdmin(): Promise<Payment[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('payments')
      .select('*, booking:bookings(*), profile:profiles(*)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[SUPABASE] getAllPaymentsForAdmin error:', error.message, error);
      throw new Error(`Failed to load payments: ${error.message}`);
    }
    return data ? (data as Payment[]) : [];
  }
  return memoryStore.payments;
}

export async function getAllLogisticsForAdmin(): Promise<LogisticsRequest[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('logistics_requests')
      .select('*, booking:bookings(*), profile:profiles(*)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[SUPABASE] getAllLogisticsForAdmin error:', error.message, error);
      throw new Error(`Failed to load logistics requests: ${error.message}`);
    }
    return data ? (data as LogisticsRequest[]) : [];
  }
  return memoryStore.logistics;
}

export async function deletePendingBooking(
  bookingId: string
): Promise<{ success: boolean; message: string; action?: 'deleted' | 'cancelled' }> {
  if (!bookingId || !bookingId.trim()) {
    throw new Error('Booking ID is required to delete a reservation.');
  }

  const cleanId = sanitizeToUuid(bookingId) || bookingId.trim();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error('Unable to verify your session. Please sign in again.');
  }
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Authentication required. Please sign in to delete this trip.');
  }

  let serverSuccess = false;
  let serverMessage = 'Trip deleted successfully.';

  try {
    const res = await fetch('/api/bookings/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ booking_id: cleanId }),
    });

    const result = await res.json();
    if (res.ok && result.success) {
      serverSuccess = true;
      serverMessage = result.message || 'Trip deleted successfully.';
    } else if (!res.ok && result?.error) {
      throw new Error(result.error);
    }
  } catch (apiErr: any) {
    if (apiErr?.message?.includes('Cannot delete a confirmed or paid reservation')) {
      throw apiErr;
    }
    console.warn('[SUPABASE] Backend delete endpoint error, attempting client RLS fallback:', apiErr);
  }

  if (!serverSuccess && isSupabaseConfigured() && !isDemoMode()) {
    // Client-side delete under RLS
    const { data: bData, error: fetchErr } = await supabase
      .from('bookings')
      .select('id, payment_status, booking_status')
      .eq('id', cleanId)
      .maybeSingle();

    if (fetchErr) {
      throw new Error(fetchErr.message || 'Unable to access booking.');
    }

    if (bData) {
      const pStatus = String(bData.payment_status || '').toLowerCase();
      const bStatus = String(bData.booking_status || '').toLowerCase();
      if (pStatus === 'paid' || bStatus === 'confirmed') {
        throw new Error('Cannot delete a confirmed or paid reservation. Confirmed bookings must be preserved.');
      }

      await supabase.from('logistics_requests').delete().eq('booking_id', cleanId);
      await supabase.from('payments').delete().eq('booking_id', cleanId).eq('status', 'pending');

      const { error: delErr } = await supabase.from('bookings').delete().eq('id', cleanId);
      if (delErr) {
        throw new Error(delErr.message || 'Failed to delete reservation.');
      }
    }
  }

  const bIdx = memoryStore.bookings.findIndex(
    (b) => b.id === cleanId || b.booking_reference === cleanId
  );
  if (bIdx !== -1) {
    memoryStore.bookings.splice(bIdx, 1);
  }

  return {
    success: true,
    message: serverMessage,
    action: 'deleted',
  };
}

export async function cancelBooking(
  bookingId: string
): Promise<{ success: boolean; message: string; action?: 'cancelled' }> {
  if (!bookingId || !bookingId.trim()) {
    throw new Error('Booking ID is required to cancel a reservation.');
  }

  const cleanId = sanitizeToUuid(bookingId) || bookingId.trim();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new Error('Unable to verify your session. Please sign in again.');
  }
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Authentication required. Please sign in to cancel this trip.');
  }

  let serverSuccess = false;
  let serverMessage = 'Reservation cancelled successfully.';

  try {
    const res = await fetch('/api/bookings/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ booking_id: cleanId }),
    });

    const result = await res.json();
    if (res.ok && result.success) {
      serverSuccess = true;
      serverMessage = result.message || 'Reservation cancelled successfully.';
    } else if (!res.ok && result?.error) {
      throw new Error(result.error);
    }
  } catch (apiErr: any) {
    console.warn('[SUPABASE] Backend cancel endpoint error, attempting client RLS fallback:', apiErr);
  }

  if (!serverSuccess && isSupabaseConfigured() && !isDemoMode()) {
    const { error: updErr } = await supabase
      .from('bookings')
      .update({
        booking_status: 'cancelled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', cleanId);

    if (updErr) {
      throw new Error(updErr.message || 'Failed to cancel reservation.');
    }
  }

  const memIdx = memoryStore.bookings.findIndex(
    (b) => b.id === cleanId || b.booking_reference === cleanId
  );
  if (memIdx !== -1) {
    memoryStore.bookings[memIdx].status = 'cancelled';
    memoryStore.bookings[memIdx].booking_status = 'cancelled';
  }

  return {
    success: true,
    message: serverMessage,
    action: 'cancelled',
  };
}

export async function deleteOrCancelBooking(
  booking: Booking
): Promise<{ success: boolean; message: string; action: 'deleted' | 'cancelled' }> {
  const pStatus = String(booking.payment_status || '').toLowerCase();
  const bStatus = String(booking.booking_status || booking.status || '').toLowerCase();

  const isPaidOrConfirmed = pStatus === 'paid' || bStatus === 'confirmed';

  if (isPaidOrConfirmed) {
    const res = await cancelBooking(booking.id);
    return {
      success: res.success,
      message: res.message,
      action: 'cancelled',
    };
  } else {
    const res = await deletePendingBooking(booking.id);
    return {
      success: res.success,
      message: res.message,
      action: 'deleted',
    };
  }
}

export async function createStandaloneLogisticsRequest(payload: {
  user_id: string;
  booking_id?: string | null;
  type: LogisticsType;
  service_name?: string;
  airport?: string;
  arrival_date?: string;
  arrival_time?: string;
  flight_number?: string;
  departure_date?: string;
  departure_time?: string;
  departure_flight_number?: string;
  pickup_location: string;
  dropoff_location?: string;
  request_date?: string;
  request_time?: string;
  passengers: number;
  amount: number;
  notes?: string;
  status?: string;
}): Promise<LogisticsRequest> {
  const cleanRecord: any = {
    user_id: payload.user_id,
    type: payload.type,
    service_type: payload.type,
    service_name: payload.service_name || String(payload.type).replace(/_/g, ' ').toUpperCase(),
    airport: payload.airport || null,
    arrival_date: payload.arrival_date || payload.request_date || null,
    arrival_time: payload.arrival_time || payload.request_time || null,
    pickup_date: payload.arrival_date || payload.request_date || null,
    pickup_time: payload.arrival_time || payload.request_time || null,
    flight_number: payload.flight_number || null,
    departure_date: payload.departure_date || null,
    departure_time: payload.departure_time || null,
    departure_flight_number: payload.departure_flight_number || null,
    pickup_location: payload.pickup_location,
    dropoff_location: payload.dropoff_location || 'Event Venue / Hotel',
    request_date: payload.request_date || payload.arrival_date || null,
    request_time: payload.request_time || payload.arrival_time || null,
    passengers: payload.passengers || 1,
    amount: payload.amount || 0,
    price_ngn: payload.amount || 0,
    notes: payload.notes || '',
    status: payload.status || 'pending',
  };

  if (payload.booking_id) {
    cleanRecord.booking_id = payload.booking_id;
  }

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('logistics_requests')
      .insert(cleanRecord)
      .select('*')
      .single();
    if (error) {
      console.error('[SUPABASE] createStandaloneLogisticsRequest error:', error.message, error);
      throw new Error(`Failed to create logistics request: ${error.message}`);
    }
    const item = data;
    const mapped: LogisticsRequest = {
      id: item.id,
      user_id: item.user_id,
      booking_id: item.booking_id,
      type: (item.service_type || item.type || payload.type) as LogisticsType,
      service_name: item.service_name || payload.service_name,
      airport: item.airport,
      arrival_date: item.arrival_date || item.pickup_date,
      arrival_time: item.arrival_time || item.pickup_time,
      flight_number: item.flight_number,
      departure_date: item.departure_date,
      departure_time: item.departure_time,
      departure_flight_number: item.departure_flight_number,
      pickup_location: item.pickup_location,
      dropoff_location: item.dropoff_location,
      request_date: item.request_date || item.pickup_date,
      request_time: item.request_time || item.pickup_time,
      passengers: Number(item.passengers || 1),
      status: item.status || 'pending',
      amount: Number(item.price_ngn ?? item.amount ?? payload.amount ?? 0),
      notes: item.notes || '',
      created_at: item.created_at || new Date().toISOString(),
    };
    return mapped;
  }

  const memoryId = `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  const memoryMapped: LogisticsRequest = {
    id: memoryId,
    user_id: payload.user_id,
    booking_id: payload.booking_id || undefined,
    type: payload.type,
    service_name: payload.service_name,
    airport: payload.airport,
    arrival_date: payload.arrival_date,
    arrival_time: payload.arrival_time,
    flight_number: payload.flight_number,
    departure_date: payload.departure_date,
    departure_time: payload.departure_time,
    departure_flight_number: payload.departure_flight_number,
    pickup_location: payload.pickup_location,
    dropoff_location: payload.dropoff_location || 'Event Venue',
    request_date: payload.request_date,
    request_time: payload.request_time,
    passengers: payload.passengers || 1,
    status: 'pending',
    amount: payload.amount || 0,
    notes: payload.notes || '',
    created_at: new Date().toISOString(),
  };
  memoryStore.logistics.unshift(memoryMapped);
  return memoryMapped;
}

export async function getCustomerLogistics(userId?: string): Promise<LogisticsRequest[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    let query = supabase.from('logistics_requests').select('*, booking:bookings(*)');
    if (userId) {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
      console.error('[SUPABASE] getCustomerLogistics error:', error.message, error);
      throw new Error(`Failed to load logistics requests: ${error.message}`);
    }
    return (data || []).map((item: any) => ({
      id: item.id,
      user_id: item.user_id,
      booking_id: item.booking_id,
      type: (item.service_type || item.type) as LogisticsType,
      service_name: item.service_name || String(item.service_type || item.type).replace(/_/g, ' ').toUpperCase(),
      airport: item.airport,
      arrival_date: item.arrival_date || item.pickup_date,
      arrival_time: item.arrival_time || item.pickup_time,
      flight_number: item.flight_number,
      departure_date: item.departure_date,
      departure_time: item.departure_time,
      departure_flight_number: item.departure_flight_number,
      pickup_location: item.pickup_location,
      dropoff_location: item.dropoff_location,
      request_date: item.request_date || item.pickup_date,
      request_time: item.request_time || item.pickup_time,
      passengers: Number(item.passengers || 1),
      status: item.status || 'pending',
      amount: Number(item.price_ngn ?? item.amount ?? 0),
      notes: item.notes || '',
      created_at: item.created_at || new Date().toISOString(),
      booking: item.booking ? mapDbBookingToAppBooking(item.booking) : undefined,
    }));
  }
  return memoryStore.logistics.filter((l) => !userId || l.user_id === userId);
}

export async function getAllRoomsForAdmin(): Promise<Room[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('rooms')
      .select('*, property:properties(*)')
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[SUPABASE] getAllRoomsForAdmin error:', error.message, error);
      throw new Error(`Failed to load rooms for admin: ${error.message}`);
    }
    return (data || []).map(mapDbRoomToAppRoom);
  }
  return memoryStore.rooms.map((r) => {
    const property = memoryStore.properties.find((p) => p.id === r.property_id);
    return mapDbRoomToAppRoom({ ...r, property });
  });
}

export async function getRoomsByPropertyId(propertyId: string): Promise<Room[]> {
  const cleanPropId = sanitizeToUuid(propertyId) || propertyId;
  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('rooms')
      .select('*, property:properties(*)')
      .eq('property_id', cleanPropId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[SUPABASE] getRoomsByPropertyId error:', error.message, error);
      throw new Error(`Failed to load rooms for property: ${error.message}`);
    }
    return (data || []).map(mapDbRoomToAppRoom);
  }
  return memoryStore.rooms
    .filter((r) => r.property_id === propertyId || r.property_id === cleanPropId)
    .map((r) => {
      const property = memoryStore.properties.find((p) => p.id === r.property_id);
      return mapDbRoomToAppRoom({ ...r, property });
    });
}

export async function createRoom(payload: {
  property_id: string;
  name: string;
  description?: string;
  room_type?: string;
  capacity: number;
  price_per_night: number;
  total_rooms: number;
  available_count: number;
  amenities?: string[];
  image_url?: string;
  is_active?: boolean;
}): Promise<Room> {
  if (!payload.property_id || !payload.property_id.trim()) {
    throw new Error('Property selection is required.');
  }
  if (!payload.name || !payload.name.trim()) {
    throw new Error('Room name is required.');
  }
  if (payload.capacity <= 0) {
    throw new Error('Maximum guests must be greater than zero.');
  }
  if (payload.price_per_night < 0) {
    throw new Error('Nightly price must be greater than or equal to 0 NGN.');
  }
  if (payload.total_rooms < 0) {
    throw new Error('Total rooms cannot be negative.');
  }
  if (payload.available_count < 0) {
    throw new Error('Available rooms cannot be negative.');
  }
  if (payload.available_count > payload.total_rooms) {
    throw new Error('Available rooms cannot exceed total rooms.');
  }

  const cleanPropertyId = sanitizeToUuid(payload.property_id) || payload.property_id;
  const newRoomId = `30000000-${Math.random().toString(36).substring(2, 6)}-4000-8000-${Math.random().toString(36).substring(2, 14)}`.padEnd(36, '0').substring(0, 36);

  const dbPayload: any = {
    id: newRoomId,
    property_id: cleanPropertyId,
    name: payload.name.trim(),
    description: payload.description?.trim() || '',
    room_type: payload.room_type || payload.name.trim(),
    price_per_night_ngn: payload.price_per_night,
    price_per_night: payload.price_per_night,
    max_guests: payload.capacity,
    capacity: payload.capacity,
    total_rooms: payload.total_rooms,
    available_rooms: payload.available_count,
    available_count: payload.available_count,
    status: payload.is_active !== false,
    amenities: payload.amenities || [],
    image_url: payload.image_url || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=80',
    created_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('rooms')
      .insert(dbPayload)
      .select('*, property:properties(*)');
    if (error) {
      console.error('[ADMIN ROOMS] createRoom error:', error.message, error);
      throw new Error(`Failed to create room: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN ROOMS] createRoom inserted 0 rows');
      throw new Error('Room could not be created. No database row was inserted.');
    }
    return mapDbRoomToAppRoom(data[0]);
  }

  const appRoom = mapDbRoomToAppRoom(dbPayload);
  memoryStore.rooms.unshift(appRoom);
  return appRoom;
}

export async function updateRoom(
  roomId: string,
  updates: Partial<Room> & { is_active?: boolean; available_count?: number; total_rooms?: number }
): Promise<Room> {
  if (!roomId || !roomId.trim()) {
    throw new Error('Room ID is required for update.');
  }
  const cleanRoomId = sanitizeToUuid(roomId) || roomId;
  const existing = await getRoomById(roomId);
  if (!existing) {
    throw new Error('Room not found in database for update.');
  }

  let newTotal = updates.total_rooms !== undefined ? Number(updates.total_rooms) : (existing.total_rooms || 10);
  let newAvailable = updates.available_count !== undefined ? Number(updates.available_count) : existing.available_count;

  if (newTotal < 0) {
    throw new Error('Total rooms cannot be negative.');
  }
  if (newAvailable < 0) {
    throw new Error('Available rooms cannot be negative.');
  }

  if (updates.total_rooms !== undefined && updates.available_count === undefined) {
    const prevTotal = existing.total_rooms || 10;
    const prevAvailable = existing.available_count;
    const bookedCount = Math.max(0, prevTotal - prevAvailable);
    newAvailable = Math.max(0, newTotal - bookedCount);
  }

  if (newAvailable > newTotal) {
    newAvailable = newTotal;
  }

  const dbUpdates: any = {
    updated_at: new Date().toISOString(),
  };

  if (updates.name !== undefined) {
    if (!updates.name.trim()) throw new Error('Room title cannot be empty.');
    dbUpdates.name = updates.name.trim();
  }
  if (updates.description !== undefined) dbUpdates.description = updates.description.trim();
  if (updates.room_type !== undefined) dbUpdates.room_type = updates.room_type.trim();
  if (updates.capacity !== undefined || updates.max_guests !== undefined) {
    const cap = Number(updates.capacity || updates.max_guests);
    if (cap <= 0) throw new Error('Capacity (max guests) must be at least 1.');
    dbUpdates.capacity = cap;
    dbUpdates.max_guests = cap;
  }
  if (updates.price_per_night !== undefined || updates.price_per_night_ngn !== undefined) {
    const price = Number(updates.price_per_night ?? updates.price_per_night_ngn);
    if (price < 0) throw new Error('Nightly price must be 0 NGN or higher.');
    dbUpdates.price_per_night = price;
    dbUpdates.price_per_night_ngn = price;
  }

  dbUpdates.total_rooms = newTotal;
  dbUpdates.available_rooms = newAvailable;
  dbUpdates.available_count = newAvailable;

  if (updates.is_active !== undefined) dbUpdates.status = updates.is_active;
  if (updates.status !== undefined) dbUpdates.status = updates.status;
  if (updates.amenities !== undefined) dbUpdates.amenities = updates.amenities;
  if (updates.image_url !== undefined) dbUpdates.image_url = updates.image_url;

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('rooms')
      .update(dbUpdates)
      .eq('id', cleanRoomId)
      .select('*, property:properties(*)');
    if (error) {
      console.error('[ADMIN ROOMS] updateRoom error:', error.message, error);
      throw new Error(`Failed to update room: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN ROOMS] updateRoom affected 0 rows for ID:', cleanRoomId);
      throw new Error('Room could not be updated. No database row was changed.');
    }
    return mapDbRoomToAppRoom(data[0]);
  }

  const idx = memoryStore.rooms.findIndex((r) => r.id === roomId || r.id === cleanRoomId);
  const updatedLocal = mapDbRoomToAppRoom({
    ...existing,
    ...dbUpdates,
    id: existing.id,
    property_id: existing.property_id,
  });
  if (idx !== -1) memoryStore.rooms[idx] = updatedLocal;
  return updatedLocal;
}

export async function deleteRoom(roomId: string): Promise<{ success: boolean; message: string }> {
  if (!roomId || !roomId.trim()) {
    throw new Error('Room ID is required for deletion.');
  }
  const cleanRoomId = sanitizeToUuid(roomId) || roomId;

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { count, error: countErr } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', cleanRoomId);
    if (countErr) {
      console.error('[ADMIN ROOMS] deleteRoom count check error:', countErr.message, countErr);
      throw new Error(`Failed to verify booking associations: ${countErr.message}`);
    }
    if (count && count > 0) {
      throw new Error(`Cannot delete room: ${count} booking reservation(s) are currently attached to this room. Please deactivate it instead.`);
    }

    const { data, error: delErr } = await supabase
      .from('rooms')
      .delete()
      .eq('id', cleanRoomId)
      .select('id');
    if (delErr) {
      console.error('[ADMIN ROOMS] deleteRoom error:', delErr.message, delErr);
      throw new Error(`Failed to delete room: ${delErr.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN ROOMS] deleteRoom affected 0 rows for ID:', cleanRoomId);
      throw new Error('Room could not be deleted. No database row was removed.');
    }
    return { success: true, message: 'Room deleted successfully.' };
  }

  const hasBookings = memoryStore.bookings.some((b) => b.room_id === roomId || b.room_id === cleanRoomId);
  if (hasBookings) {
    throw new Error('Cannot delete room: bookings are attached to this room. Please deactivate it instead.');
  }
  const memIdx = memoryStore.rooms.findIndex((r) => r.id === roomId || r.id === cleanRoomId);
  if (memIdx !== -1) memoryStore.rooms.splice(memIdx, 1);
  return { success: true, message: 'Room deleted successfully.' };
}

export async function createProperty(payload: Partial<Property>): Promise<Property> {
  if (!payload.title || !payload.title.trim()) {
    throw new Error('Property title is required.');
  }
  if (!payload.venue_id || !payload.venue_id.trim()) {
    throw new Error('Associated Event Venue is required.');
  }
  const newPropId = `20000000-${Math.random().toString(36).substring(2, 6)}-4000-8000-${Math.random().toString(36).substring(2, 14)}`.padEnd(36, '0').substring(0, 36);
  const cleanVenueId = sanitizeToUuid(payload.venue_id) || payload.venue_id;

  const dbPayload: any = {
    id: newPropId,
    venue_id: cleanVenueId,
    title: payload.title.trim(),
    description: payload.description || '',
    property_type: payload.property_type || 'Hotel',
    address: payload.address || '',
    city: payload.city || 'Abuja',
    state: payload.state || 'FCT',
    country: payload.country || 'Nigeria',
    latitude: payload.latitude ?? 9.06,
    longitude: payload.longitude ?? 7.49,
    distance_to_venue_km: payload.distance_to_venue_km ?? 2.5,
    rating: payload.rating ?? 4.8,
    is_verified: payload.is_verified ?? true,
    amenities: payload.amenities || ['24/7 Power', 'High-Speed Wi-Fi', 'VVIP Security'],
    check_in_time: payload.check_in_time || '14:00',
    check_out_time: payload.check_out_time || '11:00',
    image_url: payload.image_url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80',
    photos: payload.photos || (payload.image_url ? [payload.image_url] : ['https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80']),
    phone: payload.phone || '+234 9 000 0000',
    email: payload.email || 'stay@thearkrooms.com',
    website: payload.website || 'https://thearkrooms.com',
    created_at: new Date().toISOString(),
  };

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('properties')
      .insert(dbPayload)
      .select('*, venue:venues(*)');
    if (error) {
      console.error('[ADMIN PROPERTIES] createProperty error:', error.message, error);
      throw new Error(`Failed to create property: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN PROPERTIES] createProperty inserted 0 rows');
      throw new Error('Property could not be created. No database row was inserted.');
    }
    return mapDbPropertyToAppProperty(data[0]);
  }

  const appProp = mapDbPropertyToAppProperty(dbPayload);
  memoryStore.properties.unshift(appProp);
  return appProp;
}

export async function updateProperty(propertyId: string, updates: Partial<Property>): Promise<Property> {
  if (!propertyId || !propertyId.trim()) {
    throw new Error('Property ID is required for update.');
  }
  const cleanPropId = sanitizeToUuid(propertyId) || propertyId;

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('properties')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cleanPropId)
      .select('*, venue:venues(*)');
    if (error) {
      console.error('[ADMIN PROPERTIES] updateProperty error:', error.message, error);
      throw new Error(`Failed to update property: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN PROPERTIES] updateProperty affected 0 rows for ID:', cleanPropId);
      throw new Error('Property could not be updated. No database row was changed.');
    }
    return mapDbPropertyToAppProperty(data[0]);
  }

  const idx = memoryStore.properties.findIndex((p) => p.id === propertyId || p.id === cleanPropId);
  if (idx !== -1) {
    memoryStore.properties[idx] = { ...memoryStore.properties[idx], ...updates };
    return memoryStore.properties[idx];
  }
  throw new Error('Property not found.');
}

export async function deleteProperty(propertyId: string): Promise<{ success: boolean; message: string }> {
  if (!propertyId || !propertyId.trim()) {
    throw new Error('Property ID is required for deletion.');
  }
  const cleanPropId = sanitizeToUuid(propertyId) || propertyId;

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { count: roomCount, error: countErr } = await supabase
      .from('rooms')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', cleanPropId);
    if (countErr) {
      console.error('[ADMIN PROPERTIES] deleteProperty count check error:', countErr.message, countErr);
      throw new Error(`Failed to verify room associations: ${countErr.message}`);
    }
    if (roomCount && roomCount > 0) {
      throw new Error(`Cannot delete property: ${roomCount} room(s) exist under this property. Please remove or reassign the rooms first.`);
    }

    const { data, error } = await supabase
      .from('properties')
      .delete()
      .eq('id', cleanPropId)
      .select('id');
    if (error) {
      console.error('[ADMIN PROPERTIES] deleteProperty error:', error.message, error);
      throw new Error(`Failed to delete property: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN PROPERTIES] deleteProperty affected 0 rows for ID:', cleanPropId);
      throw new Error('Property could not be deleted. No database row was removed.');
    }
    return { success: true, message: 'Property deleted successfully.' };
  }

  const idx = memoryStore.properties.findIndex((p) => p.id === propertyId || p.id === cleanPropId);
  if (idx !== -1) memoryStore.properties.splice(idx, 1);
  return { success: true, message: 'Property deleted successfully.' };
}

export async function getCustomersForAdmin(): Promise<any[]> {
  const bookings = await getAllBookingsForAdmin();
  const customerMap = new Map<string, any>();

  bookings.forEach((b) => {
    const email = (b.guest_email || b.profile?.email || 'guest@example.com').toLowerCase().trim();
    const name = `${b.guest_first_name || ''} ${b.guest_last_name || ''}`.trim() || b.profile?.full_name || 'Guest User';
    const phone = b.guest_phone || b.profile?.phone || 'N/A';
    const country = b.country || b.profile?.country || 'Nigeria';

    if (!customerMap.has(email)) {
      customerMap.set(email, {
        id: b.user_id || email,
        name,
        email,
        phone,
        country,
        total_bookings: 0,
        confirmed_bookings: 0,
        pending_bookings: 0,
        cancelled_bookings: 0,
        total_spend_ngn: 0,
        last_booking_date: b.created_at,
        bookings: [],
      });
    }

    const c = customerMap.get(email)!;
    c.total_bookings += 1;
    if (b.status === 'confirmed' || b.payment_status === 'paid' || b.payment_status === 'successful') {
      c.confirmed_bookings += 1;
      c.total_spend_ngn += (b.total_amount || 0);
    } else if (b.status === 'cancelled') {
      c.cancelled_bookings += 1;
    } else {
      c.pending_bookings += 1;
    }

    if (new Date(b.created_at) > new Date(c.last_booking_date)) {
      c.last_booking_date = b.created_at;
    }
    c.bookings.push(b);
  });

  return Array.from(customerMap.values()).sort((a, b) => b.total_bookings - a.total_bookings);
}

const VALID_BOOKING_STATUSES: BookingStatus[] = [
  'pending',
  'confirmed',
  'cancelled',
  'checked_in',
  'checked_out',
  'completed',
  'expired',
  'pending_payment',
];

export async function updateBookingStatus(
  bookingId: string,
  status: BookingStatus,
  payment_status?: string
): Promise<{ success: boolean; message: string; booking?: any }> {
  if (!bookingId || !bookingId.trim()) {
    throw new Error('A valid booking ID is required to update status.');
  }
  if (!VALID_BOOKING_STATUSES.includes(status)) {
    throw new Error(
      `Invalid booking status "${status}". Allowed statuses: ${VALID_BOOKING_STATUSES.join(', ')}`
    );
  }
  const cleanId = sanitizeToUuid(bookingId) || bookingId.trim();

  if (isSupabaseConfigured() && !isDemoMode()) {
    const updateData: any = {
      booking_status: status,
      updated_at: new Date().toISOString(),
    };
    if (payment_status) {
      updateData.payment_status = payment_status;
    }

    const { data, error } = await supabase
      .from('bookings')
      .update(updateData)
      .eq('id', cleanId)
      .select('id, booking_status, payment_status');

    if (error) {
      console.error('[ADMIN BOOKINGS] updateBookingStatus error:', error.message, error);
      throw new Error(`Failed to update booking status: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN BOOKINGS] updateBookingStatus affected 0 rows for ID:', cleanId);
      throw new Error('Booking status could not be updated. No database row was changed.');
    }
    return {
      success: true,
      message: `Booking status updated to ${status}.`,
      booking: data[0],
    };
  }

  const memIdx = memoryStore.bookings.findIndex((b) => b.id === bookingId || b.id === cleanId);
  if (memIdx !== -1) {
    memoryStore.bookings[memIdx].status = status;
    if (payment_status) memoryStore.bookings[memIdx].payment_status = payment_status as any;
    return { success: true, message: `Booking status updated to ${status}.` };
  }
  throw new Error('Booking not found.');
}

const VALID_LOGISTICS_STATUSES: LogisticsStatus[] = [
  'pending',
  'assigned',
  'in_transit',
  'scheduled',
  'completed',
  'cancelled',
  'confirmed',
];

export async function updateLogisticsStatus(
  logisticsId: string,
  status: LogisticsStatus
): Promise<{ success: boolean; message: string; logistics?: any }> {
  if (!logisticsId || !logisticsId.trim()) {
    throw new Error('A valid logistics request ID is required.');
  }
  if (!VALID_LOGISTICS_STATUSES.includes(status)) {
    throw new Error(
      `Invalid logistics status "${status}". Allowed statuses: ${VALID_LOGISTICS_STATUSES.join(', ')}`
    );
  }
  const cleanId = logisticsId.trim();

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data, error } = await supabase
      .from('logistics_requests')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cleanId)
      .select('id, status');

    if (error) {
      console.error('[ADMIN LOGISTICS] updateLogisticsStatus error:', error.message, error);
      throw new Error(`Failed to update logistics status: ${error.message}`);
    }
    if (!data || data.length === 0) {
      console.error('[ADMIN LOGISTICS] updateLogisticsStatus affected 0 rows for ID:', cleanId);
      throw new Error('Logistics status could not be updated. No database row was changed.');
    }
    return {
      success: true,
      message: `Logistics status updated to ${status}.`,
      logistics: data[0],
    };
  }

  const memIdx = memoryStore.logistics.findIndex((l) => l.id === logisticsId || l.id === cleanId);
  if (memIdx !== -1) {
    memoryStore.logistics[memIdx].status = status;
    return { success: true, message: `Logistics status updated to ${status}.` };
  }
  throw new Error('Logistics request not found.');
}

export async function getBookingDetailsForAdmin(bookingIdOrRef: string): Promise<{
  booking: Booking | null;
  payments: Payment[];
  logistics: LogisticsRequest[];
}> {
  const booking = await getBookingByIdentifier(bookingIdOrRef);
  if (!booking) {
    return { booking: null, payments: [], logistics: [] };
  }

  let payments: Payment[] = [];
  let logistics: LogisticsRequest[] = [];

  if (isSupabaseConfigured() && !isDemoMode()) {
    const { data: payData, error: payError } = await supabase
      .from('payments')
      .select('*')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false });
    if (payError) {
      console.error('[SUPABASE] getBookingDetailsForAdmin payments error:', payError.message, payError);
      throw new Error(`Failed to load booking payment audit records: ${payError.message}`);
    }
    payments = (payData || []) as Payment[];

    const { data: logData, error: logError } = await supabase
      .from('logistics_requests')
      .select('*')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false });
    if (logError) {
      console.error('[SUPABASE] getBookingDetailsForAdmin logistics error:', logError.message, logError);
      throw new Error(`Failed to load booking logistics records: ${logError.message}`);
    }
    logistics = (logData || []).map((item: any) => ({
      id: item.id,
      user_id: item.user_id,
      booking_id: item.booking_id,
      type: (item.service_type || item.type) as LogisticsType,
      service_name: item.service_name || String(item.service_type || item.type).replace(/_/g, ' ').toUpperCase(),
      airport: item.airport,
      arrival_date: item.arrival_date || item.pickup_date,
      arrival_time: item.arrival_time || item.pickup_time,
      flight_number: item.flight_number,
      departure_date: item.departure_date,
      departure_time: item.departure_time,
      departure_flight_number: item.departure_flight_number,
      pickup_location: item.pickup_location,
      dropoff_location: item.dropoff_location,
      request_date: item.request_date || item.pickup_date,
      request_time: item.request_time || item.pickup_time,
      passengers: Number(item.passengers || 1),
      status: item.status || 'pending',
      amount: Number(item.price_ngn ?? item.amount ?? 0),
      notes: item.notes || '',
      created_at: item.created_at || new Date().toISOString(),
    }));

    return { booking, payments, logistics };
  }

  if (payments.length === 0) {
    payments = memoryStore.payments.filter((p) => p.booking_id === booking.id);
  }
  if (logistics.length === 0) {
    logistics = memoryStore.logistics.filter((l) => l.booking_id === booking.id);
  }

  return { booking, payments, logistics };
}

export async function verifyAdminStatusAuthoritative(): Promise<boolean> {
  if (!isSupabaseConfigured() || isDemoMode()) {
    return false;
  }
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr || !sessionData?.session?.user) {
      return false;
    }
    const userId = sessionData.session.user.id;
    try {
      const { data: rpcRes, error: rpcErr } = await supabase.rpc('is_admin');
      if (!rpcErr && typeof rpcRes === 'boolean') {
        return rpcRes;
      }
    } catch {
      // Continue to profiles query
    }
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    if (!error && data && data.role === 'admin') {
      return true;
    }
  } catch (err) {
    console.warn('[AUTH] Error checking authoritative admin status:', err);
  }
  return false;
}

// Convenience alias exports for unified component compatibility
export const getBookings = getAllBookingsForAdmin;
export const getBookingsByUser = getUserBookings;
export const getRooms = getAllRoomsForAdmin;
export const getRoomsByProperty = getRoomsByPropertyId;

// ---------------------------------------------------------------------------
// Host Profile Helpers (Marketplace Phase 1)
// ---------------------------------------------------------------------------

export async function getHostProfileByUserId(userId: string): Promise<HostProfile | null> {
  if (!userId) return null;
  if (isSupabaseConfigured() && !isDemoMode()) {
    try {
      const { data, error } = await supabase
        .from('host_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && data) {
        return data as HostProfile;
      }
      if (error && !error.message.includes('does not exist') && !error.message.includes('schema cache')) {
        console.warn('[HOST_PROFILE] Fetch error:', error.message);
      }
    } catch (err) {
      console.warn('[HOST_PROFILE] Exception querying host profile:', err);
    }
  }

  // Fallback to memoryStore
  const found = memoryStore.hostProfiles.find((h) => h.user_id === userId);
  return found || null;
}

export async function createOrEnsureHostProfile(
  userId: string,
  hostStatus: HostStatus = 'active'
): Promise<HostProfile> {
  if (!userId) throw new Error('User ID is required to create a host profile');

  const now = new Date().toISOString();
  const newProfile: HostProfile = {
    id: `hp-${Date.now()}`,
    user_id: userId,
    host_status: hostStatus,
    commission_rate_percentage: 10.0,
    created_at: now,
    updated_at: now,
  };

  if (isSupabaseConfigured() && !isDemoMode()) {
    try {
      const { data, error } = await supabase
        .from('host_profiles')
        .insert({
          user_id: userId,
          host_status: hostStatus,
        })
        .select()
        .maybeSingle();

      if (!error && data) {
        return data as HostProfile;
      }
      if (error && !error.message.includes('does not exist') && !error.message.includes('schema cache')) {
        console.warn('[HOST_PROFILE] Database insert warning:', error.message);
      }
    } catch (err) {
      console.warn('[HOST_PROFILE] Insert exception:', err);
    }
  }

  // Fallback memory store update
  const existingIdx = memoryStore.hostProfiles.findIndex((h) => h.user_id === userId);
  if (existingIdx >= 0) {
    return memoryStore.hostProfiles[existingIdx];
  }
  memoryStore.hostProfiles.push(newProfile);
  return newProfile;
}

export async function getAllHostProfilesForAdmin(): Promise<HostProfile[]> {
  if (isSupabaseConfigured() && !isDemoMode()) {
    try {
      const { data, error } = await supabase
        .from('host_profiles')
        .select('*, profile:profiles(*)')
        .order('created_at', { ascending: false });

      if (!error && data) {
        return data as HostProfile[];
      }
      if (error && !error.message.includes('does not exist') && !error.message.includes('schema cache')) {
        console.warn('[HOST_PROFILE] Admin fetch warning:', error.message);
      }
    } catch (err) {
      console.warn('[HOST_PROFILE] Admin fetch exception:', err);
    }
  }

  return [...memoryStore.hostProfiles];
}


