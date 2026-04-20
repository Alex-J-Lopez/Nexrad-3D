import { useState, useEffect } from "react";
import type { RadarSite } from "@nexrad-3d/contracts";

export interface FlightData {
  icao24: string;
  callsign: string;
  longitude: number;
  latitude: number;
  altitude: number; // in meters
  velocity: number; // m/s
  heading: number; // degrees
}

export function useFlightData(activeSite: RadarSite | null, isEnabled: boolean) {
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!isEnabled || !activeSite) {
      setFlights([]);
      return;
    }

    const fetchFlights = async () => {
      setIsLoading(true);
      setError(null);
      try {
        // Roughly +/- 3 degrees from the radar site (~330km bounding box)
        const radius = 3.0; // degrees
        const lamin = activeSite.latitude - radius;
        const lamax = activeSite.latitude + radius;
        const lomin = activeSite.longitude - radius;
        const lomax = activeSite.longitude + radius;

        const response = await fetch(
          `/api/flights?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch flight data: ${response.status}`);
        }

        const data = await response.json();
        setFlights(data.flights || []);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
      } finally {
        setIsLoading(false);
      }
    };

    fetchFlights();
    
    // Poll every 10 seconds since OpenSky limits public API strictly
    const interval = setInterval(fetchFlights, 10000);
    return () => clearInterval(interval);
  }, [activeSite, isEnabled]);

  return { flights, isLoading, error };
}
