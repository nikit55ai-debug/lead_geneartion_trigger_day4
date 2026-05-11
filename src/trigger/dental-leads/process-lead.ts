import { task } from "@trigger.dev/sdk";

interface LeadPayload {
  name: string;
  phone: string;
  website: string | null;
  address: string;
  city: string;
}

type LeadType = "HOT" | "WARM" | "COOL";

export const processLead = task({
  id: "process-lead",
  retry: { maxAttempts: 2, minTimeoutInMs: 3000, factor: 2 },

  run: async (payload: LeadPayload) => {
    const clickupToken = process.env.CLICKUP_API_TOKEN;
    const clickupListId = process.env.CLICKUP_LIST_ID;
    if (!clickupToken) throw new Error("CLICKUP_API_TOKEN is not set");
    if (!clickupListId) throw new Error("CLICKUP_LIST_ID is not set");

    const { name, phone, website, address, city } = payload;

    let leadType: LeadType = "HOT";
    let notes = "No website found — ideal prospect for a new site";

    if (website) {
      const siteCheck = await checkWebsite(website);
      if (siteCheck.isModern) {
        leadType = "COOL";
        notes = siteCheck.notes;
      } else {
        leadType = "WARM";
        notes = siteCheck.notes;
      }
    }

    const priority = leadType === "HOT" ? 1 : leadType === "WARM" ? 2 : 3;
    const date = new Date().toISOString().split("T")[0];

    const description = [
      `Phone: ${phone}`,
      `Address: ${address}`,
      `Website: ${website ?? "None"}`,
      `Lead Type: ${leadType}`,
      `Notes: ${notes}`,
      `Found: ${date}`,
    ].join("\n");

    const res = await fetch(`https://api.clickup.com/api/v2/list/${clickupListId}/task`, {
      method: "POST",
      headers: {
        Authorization: clickupToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `${name} — ${city}`,
        description,
        priority,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ClickUp API error ${res.status}: ${body}`);
    }

    const task_data = await res.json() as { id: string };
    console.log(`Created ClickUp task for ${name} (${leadType}) → task ID: ${task_data.id}`);

    return { name, city, leadType, clickupTaskId: task_data.id };
  },
});

async function checkWebsite(url: string): Promise<{ isModern: boolean; notes: string }> {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(normalized, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadBot/1.0)" },
    });

    const html = await res.text();
    const isHttps = normalized.startsWith("https");
    const isMobileReady = html.includes("viewport") && html.includes("responsive");
    const hasModernFramework = /react|vue|next|angular|tailwind/i.test(html);
    const hasMinimalContent = html.length < 5000;

    if (!isHttps) {
      return { isModern: false, notes: "No HTTPS — outdated, insecure site" };
    }
    if (hasMinimalContent) {
      return { isModern: false, notes: "Very minimal site content — weak online presence" };
    }
    if (!isMobileReady) {
      return { isModern: false, notes: "Not mobile-friendly — needs a modern responsive site" };
    }
    if (hasModernFramework) {
      return { isModern: true, notes: "Modern site with up-to-date tech stack" };
    }

    return { isModern: false, notes: "Site appears outdated — good candidate for redesign" };
  } catch {
    return { isModern: false, notes: "Site unreachable or very slow — likely outdated or abandoned" };
  }
}
