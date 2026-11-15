// Railway infrastructure as code for AdaptiveFit (replaces railway.toml; Config as
// Code stops being read on 2026-12-01). Pulled from the live project with
// `railway config pull`, then given the build/deploy settings railway.toml carried,
// which the pull cannot see because they were applied per deploy, not stored on
// the service. nixpacks.toml (Node 22, frozen pnpm install) is still read by the
// NIXPACKS builder.
//
// Railway does not read this file on deploy: change it, run `railway config plan`,
// then `railway config apply`. ALWAYS check `railway status` names empowering-youth
// first: applying this file to another project deletes everything it does not list
// (on 2026-11-15 it deleted the WealthOS services). Variables are managed: every name must be listed
// with preserve() or apply DELETES it. Add a name here before adding it in Railway.
import { defineRailway, github, postgres, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Postgres = postgres("Postgres", { region: "europe-west4-drams3a" });
  Postgres.networking = { privateNetworkEndpoint: "postgres" };
  const postgresVolume = volume("postgres-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "europe-west4-drams3a", sizeMB: 5000 });
  const adaptivefitMobile = service("adaptivefit-mobile", {
    source: github("eranganot/adaptivefit-mobile", { branch: "main", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "NIXPACKS", buildCommand: "pnpm install --frozen-lockfile && pnpm build" },
    deploy: {
      startCommand: "pnpm start",
      // Pending migrations run before the new build takes traffic; a failure stops the deploy.
      preDeployCommand: ["pnpm db:migrate"],
      healthcheckPath: "/api/health",
      healthcheckTimeout: 120,
      // ON_FAILURE is Railway's default policy; declaring it leaves a phantom diff in plan.
      restartPolicyMaxRetries: 3,
    },
    replicas: { "europe-west4-drams3a": 1 },
    env: { ALLOWED_EMAIL: preserve(), AUTH_GOOGLE_ID: preserve(), AUTH_GOOGLE_SECRET: preserve(), AUTH_SECRET: preserve(), AUTH_TRUST_HOST: preserve(), AUTH_URL: preserve(), CRON_SECRET: preserve(), DATABASE_URL: preserve(), GEMINI_API_KEY: preserve(), GEMINI_MODEL_DEEP: preserve(), GEMINI_MODEL_FAST: preserve(), GOOGLE_FIT_CLIENT_ID: preserve(), GOOGLE_FIT_CLIENT_SECRET: preserve(), JH_PUBLIC_URL: preserve(), NEXTAUTH_URL: preserve(), NEXT_PUBLIC_APP_URL: preserve(), NEXT_PUBLIC_MAPBOX_TOKEN: preserve() },
  });

  return project("empowering-youth", {
    variables: { managed: true },
    resources: [adaptivefitMobile, Postgres, postgresVolume],
  });
});
