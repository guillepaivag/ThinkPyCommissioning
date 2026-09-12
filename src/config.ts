export type AppConfig = {
  slackBotToken: string; slackSigningSecret: string; slackAppToken: string; sqlitePath: string;
  classificationModel: string; extractionModel: string; proposalModel: string; visionModel: string; fallbackModel: string;
  evaluationDelaySeconds: number; findingCooldownMinutes: number; port: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function positive(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

export function loadConfig(): AppConfig {
  selectModelProvider();
  return {
    slackBotToken: required("SLACK_BOT_TOKEN"), slackSigningSecret: required("SLACK_SIGNING_SECRET"), slackAppToken: required("SLACK_APP_TOKEN"), sqlitePath: required("SQLITE_PATH"),
    classificationModel: required("CLASSIFICATION_MODEL"), extractionModel: required("EXTRACTION_MODEL"), proposalModel: required("PROPOSAL_MODEL"), visionModel: required("VISION_MODEL"), fallbackModel: required("FALLBACK_MODEL"),
    evaluationDelaySeconds: positive("EVALUATION_DELAY_SECONDS", 45), findingCooldownMinutes: positive("FINDING_COOLDOWN_MINUTES", 30), port: positive("PORT", 8080)
  };
}
import { selectModelProvider } from "./agent/model.js";
