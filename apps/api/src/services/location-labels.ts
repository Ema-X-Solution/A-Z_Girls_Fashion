import { db } from "../lib/db.js";
export async function locationLabels(
  rows: {
    sourceId?: string | null;
    destinationId?: string | null;
    locationId?: string | null;
  }[],
) {
  const ids = [
    ...new Set(
      rows
        .flatMap((r) => [r.sourceId, r.destinationId, r.locationId])
        .filter((id): id is string => !!id),
    ),
  ];
  const locations = await db.stockLocation.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(locations.map((l) => [l.id, l.name]));
  return new Map(ids.map((id) => [id, names.get(id) ?? id]));
}
