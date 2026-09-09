import React from 'react';
import { SearchDiagnosticData } from '../../lib/supabase';
import {
  Terminal,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Database,
  Code,
  MapPin,
  Calendar,
  Users,
  Layers,
  Building2,
  BedDouble,
  ShieldAlert,
} from 'lucide-react';

interface SearchDiagnosticPanelProps {
  data?: SearchDiagnosticData | null;
  diagnostics?: SearchDiagnosticData | null;
  loading?: boolean;
}

export const SearchDiagnosticPanel: React.FC<SearchDiagnosticPanelProps> = ({
  data,
  diagnostics,
  loading = false,
}) => {
  const panelData = diagnostics !== undefined ? diagnostics : data;
  // Completely disabled in production / external testing environments
  if (!import.meta.env.DEV) {
    return null;
  }

  if (loading) {
    return (
      <div className="mt-8 p-6 bg-slate-900 border border-slate-700 rounded-2xl text-slate-300 font-mono text-xs shadow-2xl animate-pulse">
        <div className="flex items-center gap-2 mb-2 text-[#C89B3C] font-bold">
          <Terminal className="w-4 h-4" />
          <span>TEMPORARY SUPABASE SEARCH DIAGNOSTIC</span>
        </div>
        <p>Running query & gathering database metrics...</p>
      </div>
    );
  }

  if (!panelData) return null;

  const activeData = panelData;

  if (activeData.searchNotStarted || !activeData.venueId || activeData.rpcStatus === 'NOT_STARTED') {
    return (
      <div className="mt-10 bg-slate-950 border border-slate-800 rounded-2xl p-5 sm:p-6 text-slate-200 font-sans shadow-2xl space-y-4">
        <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
          <div className="p-2 bg-slate-800 text-slate-400 rounded-xl border border-slate-700">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-wider uppercase text-slate-300">
                SEARCH NOT STARTED
              </span>
              <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-slate-700 font-bold">
                AWAITING VENUE SELECTION
              </span>
            </div>
            <p className="text-xs text-slate-400">
              No event venue has been selected yet. Select an event venue to search for nearby stays.
            </p>
          </div>
        </div>
        <div className="p-4 bg-slate-900/70 rounded-xl border border-slate-800/80 text-xs text-slate-400 space-y-1">
          <p className="font-semibold text-slate-300">Awaiting Customer Search Input</p>
          <p className="text-slate-400">
            Select an event venue and stay dates in the search box above, then click <strong>Search Stays</strong> to execute spatial proximity search and inspect diagnostic telemetry.
          </p>
        </div>
      </div>
    );
  }

  const {
    venueName,
    venueId,
    venueLat,
    venueLng,
    checkIn,
    checkOut,
    guests,
    searchRadiusKm,
    rpcFunction,
    rpcParams,
    rpcStatus,
    propertiesReturnedCount,
    rpcError,
    totalProperties,
    propertiesWithLat,
    propertiesWithLng,
    propertiesWithBoth,
    totalRooms,
    activeRooms,
    roomsWithInventory,
    roomsForGuestCount,
    allPropertyDiagnostics = [],
    rpcMatches = [],
  } = data;

  const isLatMissing = venueLat === null || venueLat === undefined;
  const isLngMissing = venueLng === null || venueLng === undefined;
  const noPropertiesExist = totalProperties === 0;
  const propertiesMissingCoords = totalProperties > 0 && propertiesWithBoth === 0;
  const rpcZeroResults = rpcStatus === 'SUCCESS' && propertiesReturnedCount === 0;
  const isRpcError = rpcStatus === 'ERROR';

  return (
    <div className="mt-10 bg-slate-950 border-2 border-amber-500/80 rounded-2xl p-5 sm:p-6 text-slate-200 font-sans shadow-2xl space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-wider uppercase text-amber-400">
                TEMPORARY DEVELOPER DIAGNOSTIC PANEL
              </span>
              <span className="text-[10px] bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-full border border-amber-500/30 font-bold">
                DEV / PREVIEW MODE
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Real-time query & schema analysis for search results troubleshooting.
            </p>
          </div>
        </div>
      </div>

      {/* Critical Status Alerts Section */}
      <div className="space-y-2">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <ShieldAlert className="w-4 h-4 text-amber-400" />
          Diagnostic Status & Flags
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Latitude Status */}
          {isLatMissing ? (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-200 text-xs font-bold flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>⚠ VENUE HAS NO LATITUDE</span>
            </div>
          ) : (
            <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Venue Latitude Present: {venueLat}</span>
            </div>
          )}

          {/* Longitude Status */}
          {isLngMissing ? (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-200 text-xs font-bold flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>⚠ VENUE HAS NO LONGITUDE</span>
            </div>
          ) : (
            <div className="p-2.5 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Venue Longitude Present: {venueLng}</span>
            </div>
          )}

          {/* Properties Exist Check */}
          {noPropertiesExist && (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-200 text-xs font-bold flex items-center gap-2 col-span-full">
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>⚠ NO PROPERTIES EXIST</span>
            </div>
          )}

          {/* Missing Coords Check */}
          {propertiesMissingCoords && (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-200 text-xs font-bold flex items-center gap-2 col-span-full">
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>⚠ PROPERTIES ARE MISSING COORDINATES</span>
            </div>
          )}

          {/* RPC Error Check */}
          {isRpcError && (
            <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-red-200 text-xs font-bold flex items-start gap-2 col-span-full">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-extrabold text-red-300">⚠ RPC ERROR</div>
                <div className="text-[11px] font-mono text-red-200/90 mt-0.5 break-all">
                  {rpcError}
                </div>
              </div>
            </div>
          )}

          {/* RPC Zero Results Check */}
          {rpcZeroResults && (
            <div className="p-3 bg-amber-950/60 border border-amber-800/80 rounded-xl text-amber-200 text-xs font-bold flex items-center gap-2 col-span-full">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>⚠ RPC RETURNED ZERO PROPERTIES</span>
            </div>
          )}

          {!isLatMissing && !isLngMissing && !noPropertiesExist && !propertiesMissingCoords && !isRpcError && !rpcZeroResults && (
            <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-emerald-200 text-xs font-bold flex items-center gap-2 col-span-full">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>All diagnostic checks passed. {propertiesReturnedCount} stays retrieved.</span>
            </div>
          )}
        </div>
      </div>

      {/* Grid of Diagnostic Sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* SECTION 1: SEARCH & VENUE INPUTS */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 pb-2 border-b border-slate-800">
            <MapPin className="w-3.5 h-3.5 text-amber-400" />
            Selected Venue & Inputs
          </h5>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Selected Venue:</span>
              <span className="font-bold text-white">{venueName || 'None Selected'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Venue ID:</span>
              <code className="text-amber-300 font-mono text-[11px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                {venueId || 'None'}
              </code>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Venue Latitude:</span>
                <span className={isLatMissing ? 'text-red-400 font-bold' : 'text-emerald-300 font-mono font-bold'}>
                  {isLatMissing ? '⚠ VENUE HAS NO LATITUDE' : venueLat}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Venue Longitude:</span>
                <span className={isLngMissing ? 'text-red-400 font-bold' : 'text-emerald-300 font-mono font-bold'}>
                  {isLngMissing ? '⚠ VENUE HAS NO LONGITUDE' : venueLng}
                </span>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-500" /> Check-in:
                </span>
                <span className="font-semibold text-slate-200">{checkIn || 'Not set'}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-slate-500" /> Check-out:
                </span>
                <span className="font-semibold text-slate-200">{checkOut || 'Not set'}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <Users className="w-3 h-3 text-slate-500" /> Guests:
                </span>
                <span className="font-semibold text-slate-200">{guests}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400 flex items-center gap-1">
                  <Layers className="w-3 h-3 text-slate-500" /> Search Radius:
                </span>
                <span className="font-bold text-amber-300">{searchRadiusKm} km</span>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: SUPABASE RPC CALL & RESULT */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
          <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 pb-2 border-b border-slate-800">
            <Code className="w-3.5 h-3.5 text-amber-400" />
            Supabase RPC Execution
          </h5>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">RPC Function:</span>
              <code className="text-emerald-400 font-mono text-[11px] font-bold">{rpcFunction}</code>
            </div>
            <div className="space-y-1 bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">RPC Parameters:</span>
              <div className="font-mono text-[11px] text-slate-300 space-y-0.5">
                <div>venue_lat: <span className="text-amber-300">{String(rpcParams?.venue_lat)}</span></div>
                <div>venue_lng: <span className="text-amber-300">{String(rpcParams?.venue_lng)}</span></div>
                <div>max_distance_km: <span className="text-amber-300">{rpcParams?.max_distance_km}</span></div>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px] font-bold uppercase">RPC Status:</span>
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                    rpcStatus === 'SUCCESS'
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                      : 'bg-red-950 text-red-300 border-red-800'
                  }`}
                >
                  {rpcStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">Properties Returned:</span>
                <span className="font-bold text-white font-mono text-sm">{propertiesReturnedCount}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">RPC Error:</span>
                <div
                  className={`font-mono text-[11px] mt-0.5 p-1.5 rounded border ${
                    rpcError
                      ? 'bg-red-950/80 text-red-300 border-red-800 break-all'
                      : 'bg-slate-950 text-slate-400 border-slate-800'
                  }`}
                >
                  {rpcError || 'None'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: DATABASE DIAGNOSTICS */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3 md:col-span-2 lg:col-span-1">
          <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 pb-2 border-b border-slate-800">
            <Database className="w-3.5 h-3.5 text-amber-400" />
            Database Schema Metrics
          </h5>
          <div className="space-y-3 text-xs">
            {/* Properties metrics */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold text-[11px]">
                <Building2 className="w-3.5 h-3.5 text-slate-400" /> Properties Table:
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total properties:</span>
                  <span className="font-bold text-white">{totalProperties}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">With latitude:</span>
                  <span className="font-bold text-emerald-400">{propertiesWithLat}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">With longitude:</span>
                  <span className="font-bold text-emerald-400">{propertiesWithLng}</span>
                </div>
                <div className="flex justify-between border-t border-slate-800/80 pt-1 mt-1">
                  <span className="text-slate-300 font-bold">With both coordinates:</span>
                  <span className="font-bold text-amber-300">{propertiesWithBoth}</span>
                </div>
              </div>
            </div>

            {/* Rooms metrics */}
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-slate-300 font-bold text-[11px]">
                <BedDouble className="w-3.5 h-3.5 text-slate-400" /> Rooms Table:
              </div>
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 space-y-1 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total rooms:</span>
                  <span className="font-bold text-white">{totalRooms}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Active rooms:</span>
                  <span className="font-bold text-emerald-400">{activeRooms}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">With available inventory:</span>
                  <span className="font-bold text-emerald-400">{roomsWithInventory}</span>
                </div>
                <div className="flex justify-between border-t border-slate-800/80 pt-1 mt-1">
                  <span className="text-slate-300 font-bold">For {guests} guests (capacity):</span>
                  <span className="font-bold text-amber-300">{roomsForGuestCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 4: INDEPENDENT GEOGRAPHIC DISTANCE CALCULATIONS */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-amber-400" />
            Independent Geographic Distance Calculation (All {allPropertyDiagnostics.length} Properties)
          </h5>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
            Venue: ({venueLat ?? 'N/A'}, {venueLng ?? 'N/A'}) | Radius: {searchRadiusKm} km
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {allPropertyDiagnostics.map((prop, idx) => (
            <div
              key={prop.id}
              className={`p-3.5 rounded-xl border font-mono text-xs space-y-1.5 ${
                prop.withinRadius
                  ? 'bg-emerald-950/30 border-emerald-800/80 shadow-lg shadow-emerald-950/20'
                  : 'bg-slate-950 border-slate-800'
              }`}
            >
              <div className="text-amber-400 font-bold tracking-wider text-[11px] border-b border-slate-800/80 pb-1 flex items-center justify-between">
                <span>PROPERTY {idx + 1}</span>
                <span className="text-[10px] text-slate-400 font-mono">[{prop.id}]</span>
              </div>
              <div>
                <span className="text-slate-400">Name: </span>
                <span className="text-white font-bold">{prop.name}</span>
              </div>
              <div>
                <span className="text-slate-400">Property Type: </span>
                <span className="text-slate-300">{prop.propertyType}</span>
              </div>
              <div>
                <span className="text-slate-400">Latitude: </span>
                <span className="text-amber-300">{prop.latitude !== null ? prop.latitude : 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400">Longitude: </span>
                <span className="text-amber-300">{prop.longitude !== null ? prop.longitude : 'N/A'}</span>
              </div>
              <div>
                <span className="text-slate-400">Distance: </span>
                <span className="text-amber-300 font-bold">
                  {prop.distanceKm !== null ? `${prop.distanceKm} KM` : 'N/A'}
                </span>
              </div>
              <div className="pt-1 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-slate-400 font-bold">Within {searchRadiusKm} km:</span>
                <span
                  className={`font-black px-2 py-0.5 rounded text-[11px] border ${
                    prop.withinRadius
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-red-950/80 text-red-300 border-red-800'
                  }`}
                >
                  {prop.withinRadius ? 'YES' : 'NO'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 5: RPC MATCH RESULT */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <h5 className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5 pb-2 border-b border-slate-800">
          <Code className="w-3.5 h-3.5 text-amber-400" />
          RPC MATCH (get_nearby_properties)
        </h5>
        {rpcMatches.length === 0 ? (
          <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-amber-300/80 font-mono italic">
            No properties returned by get_nearby_properties()
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {rpcMatches.map((match, idx) => (
              <div
                key={match.id || idx}
                className="p-3.5 bg-emerald-950/40 rounded-xl border border-emerald-700/80 font-mono text-xs space-y-1.5"
              >
                <div className="text-emerald-400 font-extrabold text-[11px] uppercase tracking-wide border-b border-emerald-800/80 pb-1 flex justify-between">
                  <span>RPC MATCH {rpcMatches.length > 1 ? `#${idx + 1}` : ''}</span>
                  <span className="text-emerald-300 text-[10px]">[{match.id}]</span>
                </div>
                <div>
                  <span className="text-slate-400">Property: </span>
                  <span className="text-white font-bold">{match.name}</span>
                </div>
                <div>
                  <span className="text-slate-400">Distance: </span>
                  <span className="text-amber-300 font-bold">
                    {match.distanceKm !== null ? `${match.distanceKm} KM` : 'N/A'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
