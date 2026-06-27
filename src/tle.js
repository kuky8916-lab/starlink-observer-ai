import fetch from “node-fetch”;

const TLE_URLS = [
“https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle”,
“https://www.celestrak.com/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle”];

async function fetchOne(url) { const res = await fetch(url, { headers: {
“User-Agent”: “starlink-observer-ai” }, timeout: 15000 }); if (!res.ok)
throw new Error(HTTP ${res.status}); return await res.text(); }

export async function fetchStarlinkTles() { let lastError;

for (const url of TLE_URLS) { try { console.log(Fetching TLE: ${url});
const text = await fetchOne(url);

      const lines = text.split(/\r?\n/).filter(Boolean);
      const out = [];

      for (let i = 0; i < lines.length - 2; i += 3) {
        out.push({
          name: lines[i].trim(),
          line1: lines[i + 1],
          line2: lines[i + 2]
        });
      }

      if (out.length > 0) return out;
    } catch (e) {
      lastError = e;
      console.log(`Failed: ${url}`);
    }

}

throw new
Error(TLE fetch failed after retries: ${lastError?.message ?? "unknown"});
}

