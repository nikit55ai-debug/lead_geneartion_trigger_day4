import { schedules } from "@trigger.dev/sdk";
import { processLead } from "./process-lead.js";

const CITY_GROUPS: string[][] = [
  ["Corpus Christi TX", "Aurora CO", "Norfolk VA", "Hialeah FL", "Chandler AZ", "Lincoln NE"],
  ["Buffalo NY", "Tulsa OK", "Fresno CA", "Knoxville TN", "Des Moines IA", "Albuquerque NM"],
  ["Richmond VA", "Boise ID", "Wichita KS", "Akron OH", "El Paso TX", "Syracuse NY"],
  ["Spokane WA", "Shreveport LA", "Madison WI", "Little Rock AR", "Stockton CA", "Worcester MA"],
  ["Reno NV", "Jackson MS", "Fort Wayne IN", "Newport News VA", "Glendale AZ", "Chattanooga TN"],
  ["Lubbock TX", "Huntsville AL", "Grand Rapids MI", "Salt Lake City UT", "Wilmington NC", "Eugene OR"],
  ["Sioux Falls SD", "Laredo TX", "Lexington KY", "Anchorage AK", "Providence RI", "Tempe AZ"],
  ["Columbus GA", "Bakersfield CA", "Tacoma WA", "Augusta GA", "Baton Rouge LA", "Springfield MO"],
];

const CHAIN_EXCLUSIONS = [
  "aspen dental", "heartland dental", "western dental", "pacific dental",
  "bright now", "comfort dental", "gentle dental", "great expressions",
];

export const dentalLeadSearch = schedules.task({
  id: "dental-lead-search",
  cron: "0 9 * * 1", // Every Monday at 9am UTC

  run: async () => {
    const serperApiKey = process.env.SERPER_API_KEY;
    if (!serperApiKey) throw new Error("SERPER_API_KEY is not set");

    const weekNumber = getISOWeek(new Date());
    const cities = CITY_GROUPS[weekNumber % 8];

    console.log(`Week ${weekNumber} → searching cities: ${cities.join(", ")}`);

    let totalDispatched = 0;

    for (const city of cities) {
      const practices = await searchDentalPractices(city, serperApiKey);

      for (const practice of practices) {
        const isChain = CHAIN_EXCLUSIONS.some(chain =>
          practice.name.toLowerCase().includes(chain)
        );
        if (isChain) continue;

        await processLead.trigger(
          { ...practice, city },
          { idempotencyKey: `lead-${practice.name}-${city}-week-${weekNumber}` }
        );
        totalDispatched++;
      }
    }

    console.log(`Dispatched ${totalDispatched} leads for processing`);
    return { week: weekNumber, cities, dispatched: totalDispatched };
  },
});

async function searchDentalPractices(
  city: string,
  apiKey: string
): Promise<Array<{ name: string; phone: string; website: string | null; address: string }>> {
  const queries = [
    `dentist ${city} phone`,
    `family dentist ${city}`,
    `dental office ${city} -"aspen dental" -"heartland" -"western dental"`,
  ];

  const seen = new Set<string>();
  const results: Array<{ name: string; phone: string; website: string | null; address: string }> = [];

  for (const query of queries) {
    const res = await fetch("https://google.serper.dev/places", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "us", num: 10 }),
    });

    if (!res.ok) {
      console.warn(`Serper search failed for "${query}": ${res.status}`);
      continue;
    }

    const data = await res.json() as { places?: Array<{ title: string; phoneNumber?: string; website?: string; address?: string }> };

    for (const place of data.places ?? []) {
      if (!place.title || seen.has(place.title.toLowerCase())) continue;
      seen.add(place.title.toLowerCase());

      results.push({
        name: place.title,
        phone: place.phoneNumber ?? "N/A",
        website: place.website ?? null,
        address: place.address ?? city,
      });
    }
  }

  return results;
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
