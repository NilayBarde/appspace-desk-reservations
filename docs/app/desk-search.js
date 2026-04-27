export function searchDesks(lookup, query, maxResults = 10) {
  const q = query.toLowerCase();
  const results = [];
  for (const [name, resourceId] of Object.entries(lookup)) {
    if (name.toLowerCase().includes(q)) {
      results.push({ name, resourceId });
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

export function parseAvailability(events) {
  const organizers = new Map();
  for (const item of events) {
    const status = (item.status || "").toLowerCase();
    if (["cancelled", "canceled", "released"].includes(status)) continue;
    const name = (item.organizer || {}).name || "Unknown";
    organizers.set(name, (organizers.get(name) || 0) + 1);
  }
  return organizers;
}
