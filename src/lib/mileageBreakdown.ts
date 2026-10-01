// The mileage columns of an invoice row, as the substantiation panel shows them
// (workstream D6). Present only when the expense is a car trip, not a payment.

export interface MileageBreakdown {
  miles: number;
  rate: number;
  trips: number | null;
  parkingAndTolls: number | null;
}

export function mileageFromInvoice(row: {
  mileage_miles?: number | string | null;
  mileage_rate?: number | string | null;
  mileage_trips?: number | string | null;
  mileage_parking_tolls?: number | string | null;
}): MileageBreakdown | null {
  if (row.mileage_miles == null) return null;
  return {
    miles: Number(row.mileage_miles),
    rate: Number(row.mileage_rate ?? 0),
    trips: row.mileage_trips == null ? null : Number(row.mileage_trips),
    parkingAndTolls:
      row.mileage_parking_tolls == null
        ? null
        : Number(row.mileage_parking_tolls),
  };
}
