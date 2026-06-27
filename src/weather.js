async function getWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lon}` +
    `&hourly=cloud_cover,precipitation_probability,precipitation` +
    `&timezone=Asia%2FSeoul`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error("Weather API Error");
  }

  return await res.json();
}

module.exports = {
  getWeather,
};
