/**
 * TheArk Rooms - Authoritative Car Rental & Car Service Pricing Configuration
 *
 * CRITICAL PRICING MODEL:
 * - Prices are FINAL prices for each vehicle + service/duration combination.
 * - NO base prices + surcharges.
 * - NO hourly price + airport price.
 * - Customer selects ONE vehicle AND ONE applicable rental/service duration.
 * - The selected option's listed price is the authoritative final car-service price.
 */

export type CarDurationId =
  | '1_hour'
  | '5_hours'
  | '6_hours'
  | '8_hours'
  | '12_hours'
  | '24_hours'
  | 'airport_local'
  | 'airport_international';

export interface CarDurationOption {
  id: CarDurationId;
  label: string;
  isAirport: boolean;
  shortLabel: string;
}

export const CAR_SERVICE_DURATIONS: CarDurationOption[] = [
  { id: '1_hour', label: '1 Hour', shortLabel: '1 hr', isAirport: false },
  { id: '5_hours', label: '5 Hours', shortLabel: '5 hrs', isAirport: false },
  { id: '6_hours', label: '6 Hours', shortLabel: '6 hrs', isAirport: false },
  { id: '8_hours', label: '8 Hours', shortLabel: '8 hrs', isAirport: false },
  { id: '12_hours', label: '12 Hours', shortLabel: '12 hrs', isAirport: false },
  { id: '24_hours', label: '24 Hours', shortLabel: '24 hrs (Full Day)', isAirport: false },
  { id: 'airport_local', label: 'Airport Local', shortLabel: 'Airport Local', isAirport: true },
  { id: 'airport_international', label: 'Airport International', shortLabel: 'Airport International', isAirport: true },
];

export interface CarModelOption {
  id: string;
  name: string;
  year: number;
  make: string;
  model: string;
  capacity: string;
  description: string;
  image: string;
  fallbackImage?: string;
  rates: Record<CarDurationId, number>;
}

export const DEFAULT_CAR_FALLBACK_IMAGE = '/images/cars/car-fallback.svg';

export const CAR_MODELS: CarModelOption[] = [
  {
    id: '2018-toyota-avalon',
    name: '2018 Toyota Avalon',
    year: 2018,
    make: 'Toyota',
    model: 'Avalon',
    capacity: '4 Passengers • 3 Bags',
    description: 'Executive premium sedan featuring plush leather interior, superior rear legroom and whisper-quiet highway ride.',
    image: 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?auto=format&fit=crop&w=800&q=80',
    fallbackImage: '/images/cars/avalon-2018.jpg',
    rates: {
      '1_hour': 35000,
      '5_hours': 120000,
      '6_hours': 140000,
      '8_hours': 160000,
      '12_hours': 200000,
      '24_hours': 350000,
      'airport_local': 100000,
      'airport_international': 110000,
    },
  },
  {
    id: '2018-toyota-camry',
    name: '2018 Toyota Camry',
    year: 2018,
    make: 'Toyota',
    model: 'Camry',
    capacity: '4 Passengers • 3 Bags',
    description: 'Modern executive styling with smooth touring dynamics, climate control and spacious trunk space.',
    image: 'https://images.unsplash.com/photo-1621007947382-bb3c3994e3fb?auto=format&fit=crop&w=800&q=80',
    fallbackImage: '/images/cars/camry-2018.jpg',
    rates: {
      '1_hour': 35000,
      '5_hours': 120000,
      '6_hours': 140000,
      '8_hours': 160000,
      '12_hours': 210000,
      '24_hours': 360000,
      'airport_local': 100000,
      'airport_international': 110000,
    },
  },
  {
    id: '2017-toyota-corolla',
    name: '2017 Toyota Corolla',
    year: 2017,
    make: 'Toyota',
    model: 'Corolla',
    capacity: '4 Passengers • 2 Bags',
    description: 'Crisp, dependable city sedan ideal for corporate summits, venue commutes and seamless airport transfers.',
    image: 'https://images.unsplash.com/photo-1619682817481-e994891cd1f5?auto=format&fit=crop&w=800&q=80',
    fallbackImage: 'https://images.unsplash.com/photo-1623869675781-80aa31012a5a?auto=format&fit=crop&w=800&q=80',
    rates: {
      '1_hour': 20000,
      '5_hours': 70000,
      '6_hours': 80000,
      '8_hours': 100000,
      '12_hours': 110000,
      '24_hours': 220000,
      'airport_local': 60000,
      'airport_international': 70000,
    },
  },
  {
    id: '2015-toyota-corolla',
    name: '2015 Toyota Corolla',
    year: 2015,
    make: 'Toyota',
    model: 'Corolla',
    capacity: '4 Passengers • 2 Bags',
    description: 'Clean, dependable transit with high-efficiency air conditioning and vetted executive chauffeur.',
    image: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?auto=format&fit=crop&w=800&q=80',
    fallbackImage: '/images/cars/corolla-2015.jpg',
    rates: {
      '1_hour': 15000,
      '5_hours': 60000,
      '6_hours': 70000,
      '8_hours': 90000,
      '12_hours': 100000,
      '24_hours': 200000,
      'airport_local': 50000,
      'airport_international': 60000,
    },
  },
  {
    id: '2013-toyota-corolla',
    name: '2013 Toyota Corolla',
    year: 2013,
    make: 'Toyota',
    model: 'Corolla',
    capacity: '4 Passengers • 2 Bags',
    description: 'Budget-friendly executive transit for event errands, full-day charters and airport hops.',
    image: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?auto=format&fit=crop&w=800&q=80',
    fallbackImage: '/images/cars/corolla-2013.jpg',
    rates: {
      '1_hour': 12500,
      '5_hours': 50000,
      '6_hours': 60000,
      '8_hours': 80000,
      '12_hours': 90000,
      '24_hours': 180000,
      'airport_local': 40000,
      'airport_international': 50000,
    },
  },
];

/**
 * Resolves any vehicle identifier, model name, or legacy string to a valid CarModelOption.
 */
export function resolveCarModel(identifier?: string | null): CarModelOption {
  if (!identifier || typeof identifier !== 'string') {
    return CAR_MODELS[0]; // Default to 2018 Toyota Avalon
  }

  const clean = identifier.trim().toLowerCase();

  // Exact ID or Name match
  const directMatch = CAR_MODELS.find(
    (c) => c.id === identifier || c.name.toLowerCase() === clean
  );
  if (directMatch) return directMatch;

  // Fuzzy match on year and model
  if (clean.includes('avalon')) {
    return CAR_MODELS[0]; // 2018 Toyota Avalon
  }
  if (clean.includes('camry')) {
    return CAR_MODELS[1]; // 2018 Toyota Camry
  }
  if (clean.includes('corolla')) {
    if (clean.includes('2017')) return CAR_MODELS[2];
    if (clean.includes('2015')) return CAR_MODELS[3];
    if (clean.includes('2013')) return CAR_MODELS[4];
    return CAR_MODELS[2]; // Default Corolla: 2017
  }

  // Legacy mappings
  if (clean.includes('suv') || clean.includes('executive')) {
    return CAR_MODELS[0]; // Avalon
  }
  if (clean.includes('sedan') || clean.includes('standard')) {
    return CAR_MODELS[1]; // Camry
  }

  return CAR_MODELS[0];
}

/**
 * Resolves a duration identifier, label, or legacy string to a valid CarDurationOption.
 */
export function resolveCarDuration(identifier?: string | null): CarDurationOption {
  if (!identifier || typeof identifier !== 'string') {
    return CAR_SERVICE_DURATIONS[0]; // Default 1 Hour
  }

  const clean = identifier.trim().toLowerCase();

  const directMatch = CAR_SERVICE_DURATIONS.find(
    (d) => d.id === identifier || d.label.toLowerCase() === clean
  );
  if (directMatch) return directMatch;

  // Airport checks
  if (clean.includes('international')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === 'airport_international')!;
  }
  if (clean.includes('airport') || clean.includes('local') || clean.includes('transfer')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === 'airport_local')!;
  }

  // Hourly checks
  if (clean.includes('24') || clean.includes('day')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === '24_hours')!;
  }
  if (clean.includes('12')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === '12_hours')!;
  }
  if (clean.includes('8')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === '8_hours')!;
  }
  if (clean.includes('6')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === '6_hours')!;
  }
  if (clean.includes('5')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === '5_hours')!;
  }
  if (clean.includes('1')) {
    return CAR_SERVICE_DURATIONS.find((d) => d.id === '1_hour')!;
  }

  return CAR_SERVICE_DURATIONS[0];
}

/**
 * Retrieves the EXACT FINAL price for a given vehicle + duration combination.
 * NO base prices, NO surcharges, NO additions.
 */
export function getCarServiceFinalPrice(
  vehicleIdentifier?: string | null,
  durationIdentifier?: string | null
): number {
  const car = resolveCarModel(vehicleIdentifier);
  const duration = resolveCarDuration(durationIdentifier);

  const finalPrice = car.rates[duration.id];
  return typeof finalPrice === 'number' && Number.isFinite(finalPrice) && finalPrice > 0
    ? finalPrice
    : 35000;
}

/**
 * Returns the descriptive service title for invoicing and booking line items.
 * e.g. "2018 Toyota Avalon (Airport Local)"
 */
export function getCarServiceTitle(
  vehicleIdentifier?: string | null,
  durationIdentifier?: string | null
): string {
  const car = resolveCarModel(vehicleIdentifier);
  const duration = resolveCarDuration(durationIdentifier);
  return `${car.name} (${duration.label})`;
}
