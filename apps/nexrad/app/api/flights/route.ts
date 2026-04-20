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

function parseBoundingBox(searchParams: URLSearchParams) {
  const laminRaw = searchParams.get("lamin");
  const lominRaw = searchParams.get("lomin");
  const lamaxRaw = searchParams.get("lamax");
  const lomaxRaw = searchParams.get("lomax");

  if (!laminRaw || !lominRaw || !lamaxRaw || !lomaxRaw) {
    return {
      error: "Missing required bounding box parameters: lamin, lomin, lamax, lomax",
    };
  }

  const lamin = Number(laminRaw);
  const lomin = Number(lominRaw);
  const lamax = Number(lamaxRaw);
  const lomax = Number(lomaxRaw);

  if (
    !Number.isFinite(lamin) ||
    !Number.isFinite(lomin) ||
    !Number.isFinite(lamax) ||
    !Number.isFinite(lomax)
  ) {
    return {
      error: "Bounding box parameters must be finite numbers",
    };
  }

  if (lamin < -90 || lamin > 90 || lamax < -90 || lamax > 90) {
    return {
      error: "Latitude parameters must be between -90 and 90",
    };
  }

  if (lomin < -180 || lomin > 180 || lomax < -180 || lomax > 180) {
    return {
      error: "Longitude parameters must be between -180 and 180",
    };
  }

  if (lamin >= lamax || lomin >= lomax) {
    return {
      error: "Bounding box parameters must satisfy lamin < lamax and lomin < lomax",
    };
  }

  return {
    lamin,
    lomin,
    lamax,
    lomax,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = parseBoundingBox(searchParams);

  if ("error" in bbox) {
    return NextResponse.json({ error: bbox.error }, { status: 400 });
  }

  const { lamin, lomin, lamax, lomax } = bbox;
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
