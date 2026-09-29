import { appConfig } from "./appConfig.generated";

export const modelDescriptions: Record<string, string> = Object.fromEntries(
  appConfig.models.map((model) => [model.id, model.description]),
);
export const modelNames: Record<string, string> = Object.fromEntries(
  appConfig.models.map((model) => [model.id, model.name]),
);
