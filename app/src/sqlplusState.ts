import type { BindKind } from "./types";

export interface SqlplusState {
  settings: {
    linesize: number;
    pagesize: number;
    feedback: boolean | number;
    heading: boolean;
    timing: boolean;
    serveroutput: boolean;
    serveroutputSize?: number;
  };
  defines: Map<string, string>;
  vars: Map<string, { type: BindKind; value: string | null }>;
  lastCreated?: string;
  spool?: { path: string; lines: string[] };
}

export function createSqlplusState(): SqlplusState {
  return {
    settings: { linesize: 80, pagesize: 14, feedback: 6, heading: true, timing: false, serveroutput: true },
    defines: new Map(),
    vars: new Map(),
  };
}
