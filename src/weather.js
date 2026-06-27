export async function getWeatherForecast(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lon}` +
    `&hourly=cloud_cover,precipitation_probability,visibility` +
    `&forecast_days=2` +
    `&timezone=Asia%2FSeoul`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Weather API error: ${res.status}`);
  }

  return await res.json();
}

export function findNearestWeather(weather, targetDate) {
  const times = weather.hourly?.time || [];
  const clouds = weather.hourly?.cloud_cover || [];
  const pops = weather.hourly?.precipitation_probability || [];
  const visibility = weather.hourly?.visibility || [];

  let bestIndex = -1;
  let bestDiff = Infinity;

  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]);
    const diff = Math.abs(t.getTime() - targetDate.getTime());

    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }

  if (bestIndex < 0) {
    return {
      cloudCover: 100,
      precipitationProbability: 100,
      visibility: 0
    };
  }

  return {
    cloudCover: clouds[bestIndex] ?? 100,
    precipitationProbability: pops[bestIndex] ?? 100,
    visibility: visibility[bestIndex] ?? 0
  };
}
