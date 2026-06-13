import { CompactRow, DataDictionaries } from '../api/dataTypes';
import { ProcessedRequest } from './dataProcessing';

function lookup(dict: string[], idx: number | null): string | null {
  if (idx === null || idx === undefined) return null;
  return dict[idx] ?? null;
}

function msToIso(ms: number | null): string | null {
  if (ms === null) return null;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

function computeAgeDays(addMs: number): number {
  return Math.floor((Date.now() - addMs) / 86400000);
}

function computeAgeBucket(ageDays: number, dicts: DataDictionaries): string {
  if (ageDays < 7) return dicts.ageBuckets[0];
  if (ageDays < 30) return dicts.ageBuckets[1];
  if (ageDays < 60) return dicts.ageBuckets[2];
  return dicts.ageBuckets[3];
}

function resolveEncodedIndex(
  value: number | null,
  dict: string[],
): string | null {
  if (value === null) return null;
  const entry = dict[value];
  return entry !== undefined ? entry : null;
}

/** Expands compact shard rows into ProcessedRequest objects for charts and filters. */
export function hydrateRows(rows: CompactRow[], dicts: DataDictionaries): ProcessedRequest[] {
  return rows.map((row) => {
    const date = new Date(row.a);
    const week = new Date(row.wk);
    const serviceType = dicts.serviceTypes[row.st];
    const category = dicts.categories[row.c];
    const ward = dicts.wards[row.w];
    const status = dicts.statuses[row.ss];
    const agency = lookup(dicts.agencies, row.ag);
    const dayOfWeek = dicts.dayOfWeek[row.dow];
    const age_days = computeAgeDays(row.a);
    const age_bucket = computeAgeBucket(age_days, dicts);

    const encodedCode = resolveEncodedIndex(row.sc, dicts.serviceCodes);
    const serviceCode = encodedCode !== null
      ? (parseInt(encodedCode, 10) || 0)
      : (row.sc ?? 0);

    const encodedPri = resolveEncodedIndex(row.pri, dicts.priorities);
    const priority = encodedPri !== null
      ? (parseInt(encodedPri, 10) || null)
      : row.pri;

    return {
      SERVICEREQUESTID: row.id,
      ADDDATE: msToIso(row.a)!,
      RESOLUTIONDATE: msToIso(row.r),
      SERVICEDUEDATE: msToIso(row.dd),
      SERVICEORDERDATE: null,
      INSPECTIONDATE: null,
      CREATED: null,
      EDITED: null,
      SERVICECODE: serviceCode,
      SERVICECODEDESCRIPTION: serviceType,
      SERVICETYPECODEDESCRIPTION: lookup(dicts.serviceTypeCodes, row.stc),
      ORGANIZATIONACRONYM: agency,
      SERVICEORDERSTATUS: status,
      STATUS_CODE: null,
      PRIORITY: priority,
      SERVICECALLCOUNT: null,
      INSPECTIONFLAG: null,
      INSPECTORNAME: null,
      STREETADDRESS: row.addr,
      CITY: lookup(dicts.cities, row.city),
      STATE: lookup(dicts.states, row.state),
      ZIPCODE: lookup(dicts.zipcodes, row.zip),
      DETAILS: row.det,
      WARD: ward,
      LATITUDE: row.lat,
      LONGITUDE: row.lng,
      date,
      week,
      hour: row.h,
      dayOfWeek,
      category,
      is_open: row.io === 1,
      is_closed: row.ic === 1,
      age_days,
      resolution_days: row.rd,
      age_bucket,
    };
  });
}
