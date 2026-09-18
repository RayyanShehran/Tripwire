"use client";
import { createContext, useContext, type ReactNode } from "react";

export type GridDisplayOptions = {
  showLineIds: boolean;
  showLineLoading: boolean;
  showElectricalValues: boolean;
  showStatusText: boolean;
};

export const defaultGridDisplayOptions: GridDisplayOptions = {
  showLineIds: true,
  showLineLoading: true,
  showElectricalValues: true,
  showStatusText: true,
};

const GridDisplayContext = createContext(defaultGridDisplayOptions);

export function GridDisplayProvider({ children, value }: { children: ReactNode; value: GridDisplayOptions }) {
  return <GridDisplayContext.Provider value={value}>{children}</GridDisplayContext.Provider>;
}

export function useGridDisplayOptions(): GridDisplayOptions {
  return useContext(GridDisplayContext);
}
