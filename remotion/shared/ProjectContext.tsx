"use client";

import React, { createContext, useContext, useMemo } from "react";
import type { Timing } from "../../lib/align";
import { resolveSceneTimings } from "../../lib/align";
import type { VideoProject } from "../../lib/schema";

type Ctx = { project: VideoProject; timing: Timing };

const ProjectCtx = createContext<Ctx | null>(null);

export const ProjectProvider: React.FC<{
  project: VideoProject;
  children: React.ReactNode;
}> = ({ project, children }) => {
  const value = useMemo(
    () => ({ project, timing: resolveSceneTimings(project) }),
    [project],
  );
  return <ProjectCtx.Provider value={value}>{children}</ProjectCtx.Provider>;
};

export function useProject(): Ctx {
  const ctx = useContext(ProjectCtx);
  if (!ctx) {
    throw new Error("useProject must be used inside <ProjectProvider>");
  }
  return ctx;
}
