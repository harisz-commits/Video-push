/**
 * Plain constants shared by the server routes and the Remotion entry point.
 *
 * Kept free of React imports on purpose: /api/render only needs the composition
 * id, and importing it from Root.tsx would drag the entire component tree into
 * a server route.
 */
export const COMP_NAME = "InfographicsVideo";
