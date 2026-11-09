import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const adaptivefitMobile = service("adaptivefit-mobile", {
    source: github("eranganot/adaptivefit-mobile", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "RAILPACK" },
    replicas: { "europe-west4-drams3a": 1 },
    env: { ALLOWED_EMAIL: preserve(), AUTH_GOOGLE_ID: preserve(), AUTH_GOOGLE_SECRET: preserve(), AUTH_SECRET: preserve(), AUTH_TRUST_HOST: preserve(), AUTH_URL: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), GEMINI_API_KEY: preserve(), GEMINI_MODEL_DEEP: preserve(), GEMINI_MODEL_FAST: preserve(), GOOGLE_FIT_CLIENT_ID: preserve(), GOOGLE_FIT_CLIENT_SECRET: preserve(), JH_PUBLIC_URL: preserve(), NEXTAUTH_URL: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_MAPBOX_TOKEN: preserve() },
  });

  return project("empowering-youth", {
    variables: { managed: true },
    resources: [adaptivefitMobile, Postgres, postgresVolume],
  });
});
