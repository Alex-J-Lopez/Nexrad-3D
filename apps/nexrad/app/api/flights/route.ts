import { NextResponse } from "next/server";

export interface FlightData {
  icao24: string;
  callsign: string;
  longitude: number;
  latitude: number;
  altitude: number; // in meters (geo_altitude or baro_altitude)
  velocity: number; // m/s
  heading: number; // degrees
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lamin = searchParams.get("lamin");
  const lomin = searchParams.get("lomin");
  const lamax = searchParams.get("lamax");
  const lomax = searchParams.get("lomax");

  if (!lamin || !lomin || !lamax || !lomax) {
    return NextResponse.json(
      { error: "Missing required bounding box parameters: lamin, lomin, lamax, lomax" },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(
      `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`,
      {
        headers: {
          "User-Agent": "Nexrad-3D Flight Tracker (https://github.com/alexanderlopez/Nexrad-3D)",
        },
        next: {
          revalidate: 10, // Cache for at least 10 seconds to respect OpenSky rate limits
        },
      }
    );

    if (!response.ok) {
      throw new Error(`OpenSky API responded with status ${response.status}`);
    }

    const data = await response.json();
    const states: any[][] = data.states || [];

    const flights: FlightData[] = states
      .filter((state) => !state[8] && state[5] !== null && state[6] !== null) // Not on ground, valid lat/lon
      .map((state) => ({
        icao24: state[0],
        callsign: state[1] ? state[1].trim() : "UNKNOWN",
        longitude: state[5],
        latitude: state[6],
        altitude: state[13] ?? state[7] ?? 0, // geo_altitude fallback to baro_altitude
        velocity: state[9] ?? 0,
        heading: state[10] ?? 0,
      }));

    return NextResponse.json({ flights });
  } catch (error) {
    console.error("Error fetching flights from OpenSky:", error);
    return NextResponse.json({ error: "Failed to fetch flight data" }, { status: 500 });
  }
}
