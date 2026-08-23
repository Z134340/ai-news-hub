#!/usr/bin/env node
/** Deterministic UI contract checks for the ANH-004 System Status panel. */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DASHBOARD_PATH = join(ROOT, "assets/js/dashboard.js");
const CSS_PATH = join(ROOT, "assets/css/app.css");
const INDEX_PATH = join(ROOT, "index.html");
const source = readFileSync(DASHBOARD_PATH, "utf8");
const css = readFileSync(CSS_PATH, "utf8");
const index = readFileSync(INDEX_PATH, "utf8");

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[char]);
}

const context = vm.createContext({
  console, Date, Intl, isFinite,
  esc: escapeHtml,
  svg: (name) => `<svg data-icon="${escapeHtml(name)}"></svg>`,
  __fixture: null,
});
vm.runInContext(source, context, { filename: DASHBOARD_PATH });

function render(fixture) {
  context.__fixture = fixture;
  return vm.runInContext("DASH.systemStatus = __fixture; dashSystemStatusBlock()", context);
}

function baseStatus() {
  return {
    schema_version: "system-status-v1",
    generated_at: "2026-08-14T09:21:03.999Z",
    source_manifest: {
      schema_version: "current-state-manifest-v1",
      generated_at: "2026-08-14T09:21:03.999Z",
      sha256: "a".repeat(64),
    },
    source_latest_date: "2026-08-13",
    preview_generated_at: "2026-08-13T10:15:14.441Z",
    public_generated_at: "2026-08-13T10:16:00.000Z",
    lag_hours: 0,
    freshness_state: "fresh",
    publish_state: "published",
    blocked_reason: null,
    artifact_health: {
      ingestion: "available", preview: "available", public: "available", agent_run: "ok",
    },
    advisory: true,
    production_write: false,
    publish_authority: "owner_only",
  };
}

let total = 0;
let failures = 0;
function check(name, condition) {
  total += 1;
  if (condition) console.log(`  ok   ${name}`);
  else { failures += 1; console.log(`  FAIL ${name}`); }
}

const fresh = render(baseStatus());
check("current/fresh renders as published", fresh.includes('data-system-status="fresh"')
  && fresh.includes("最新公開") && fresh.includes("Public 已對齊") && fresh.includes("2026-08-13"));

const pendingFixture = baseStatus();
pendingFixture.freshness_state = "pending";
pendingFixture.publish_state = "pending_owner_review";
pendingFixture.public_generated_at = "2026-07-31T02:00:39.431Z";
pendingFixture.lag_hours = 320.2431;
const pending = render(pendingFixture);
check("pending distinguishes preview from public", pending.includes('data-system-status="pending"')
  && pending.includes("等待 Owner 審核") && pending.includes("Preview 不代表已發布")
  && pending.includes("320.2 小時"));

const staleFixture = baseStatus();
staleFixture.freshness_state = "stale";
staleFixture.publish_state = "blocked";
staleFixture.blocked_reason = "ingestion_stale";
const stale = render(staleFixture);
check("stale renders policy reason", stale.includes('data-system-status="stale"')
  && stale.includes("資料過期") && stale.includes("超過 26 小時") && stale.includes("ingestion_stale"));

const blockedFixture = baseStatus();
blockedFixture.freshness_state = "blocked";
blockedFixture.publish_state = "blocked";
blockedFixture.blocked_reason = "preview_artifact_missing";
blockedFixture.source_latest_date = null;
blockedFixture.preview_generated_at = null;
blockedFixture.public_generated_at = null;
blockedFixture.lag_hours = null;
blockedFixture.artifact_health.preview = "missing";
const blocked = render(blockedFixture);
check("blocked renders evidence health and reason", blocked.includes('data-system-status="blocked"')
  && blocked.includes("Preview artifact 缺失") && blocked.includes('data-health="missing"'));

const missing = render(null);
check("missing status fails honest", missing.includes('data-system-status="missing"')
  && missing.includes("data/agent/system-status.json") && missing.includes("不可假設目前 public 是最新")
  && !missing.includes("最新公開"));

const tampered = baseStatus();
tampered.publish_authority = "agent";
const invalid = render(tampered);
check("tampered authority fails closed", invalid.includes('data-system-status="invalid"')
  && invalid.includes("狀態契約無效") && !invalid.includes("最新公開"));

check("dashboard fetches only the public status path",
  /dashFetch\('data\/agent\/system-status\.json'\)/.test(source)
  && !/dashFetch\('data\/agent\/\.preview\/system-status\.json'\)/.test(source));
check("status block is rendered before trend content",
  source.indexOf("dashSystemStatusBlock() +") < source.indexOf("dashBumpBlock() +"));
check("responsive and semantic status CSS exists",
  css.includes(".dss-grid{display:grid") && css.includes(".dss-health[data-health=")
  && /@media\(max-width:768px\)[\s\S]*\.dss-grid\{grid-template-columns:1fr 1fr\}/.test(css));
check("classic script order keeps dashboard before main",
  index.indexOf('src="assets/js/dashboard.js"') < index.indexOf('src="assets/js/main.js"'));
check("all rendered states escape raw reason codes", !blocked.includes("<script"));

console.log(`[dashboard-system-status] self-test: ${total} cases, ${failures} failed`);
process.exit(failures ? 1 : 0);
