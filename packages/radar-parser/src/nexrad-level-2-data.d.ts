declare module "nexrad-level-2-data" {
  export interface HighResData {
    gate_count: number;
    gate_size: number;
    first_gate: number;
    rf_threshold: number;
    snr_threshold: number;
    scale: number;
    offset: number;
    block_type: string;
    control_flags: number;
    data_size: number;
    name: string;
    spare: Buffer[];
    moment_data: Array<number | null>;
  }

  export interface RadialData {
    nyquist_velocity?: number;
  }

  export interface MessageHeader {
    elevation_angle: number;
    radial?: RadialData;
  }

  export interface Level2Header {
    ICAO?: string;
  }

  export interface ParserOptions {
    logger?: false | { log: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  }

  export class Level2Radar {
    constructor(file: Buffer, options?: ParserOptions);

    header: Level2Header;

    setElevation(elevation: number): void;

    listElevations(): number[];

    getScans(): number;

    getAzimuth(scan?: number): number | number[];

    getHeader(scan?: number): MessageHeader | MessageHeader[];

    getHighresReflectivity(scan?: number): HighResData | HighResData[];

    getHighresVelocity(scan?: number): HighResData | HighResData[];

    getHighresSpectrum(scan?: number): HighResData | HighResData[];

    getHighresDiffReflectivity(scan?: number): HighResData | HighResData[];

    getHighresDiffPhase(scan?: number): HighResData | HighResData[];

    getHighresCorrelationCoefficient(scan?: number): HighResData | HighResData[];
  }
}
