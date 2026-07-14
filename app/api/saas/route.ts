import { createProject, createSimulationRun, getSaasSnapshot, inviteWorkspaceMember, updateWorkspace, verifySimulationRun } from "../../../db/saas";

function identity(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email");
  if (email) return email;
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return "demo@worldmodel.dev";
  return null;
}

function failure(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const status = message.includes("role") ? 403 : message.includes("not found") ? 404 : message.includes("limit") ? 429 : 500;
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const email = identity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    return Response.json({ ...(await getSaasSnapshot(email)), user: { email, displayName: email.split("@")[0] } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load workspace" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const email = identity(request);
  if (!email) return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: { action?: string; name?: string; repository?: string; branch?: string; email?: string; role?: string; scenario?: string; projectId?: string; runId?: string };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "A valid JSON request body is required" }, { status: 400 }); }
  if (payload.action === "create-run") {
    const scenario = payload.scenario;
    if (scenario !== "traffic" && scenario !== "database" && scenario !== "payments") return Response.json({ error: "Choose a supported simulation scenario" }, { status: 400 });
    try { return Response.json({ run: await createSimulationRun(email, scenario, payload.projectId) }, { status: 201 }); }
    catch (error) { return failure(error, "Unable to create simulation run"); }
  }
  if (payload.action === "verify-run") {
    if (!payload.runId) return Response.json({ error: "A simulation run is required" }, { status: 400 });
    try { return Response.json({ run: await verifySimulationRun(email, payload.runId) }); }
    catch (error) { return failure(error, "Unable to verify simulation run"); }
  }
  if (payload.action === "update-workspace") {
    const name = payload.name?.trim();
    if (!name || name.length > 80) return Response.json({ error: "A workspace name under 80 characters is required" }, { status: 400 });
    try { return Response.json({ workspace: await updateWorkspace(email, name) }); }
    catch (error) { return failure(error, "Unable to update workspace"); }
  }
  if (payload.action === "invite-member") {
    const memberEmail = payload.email?.trim().toLowerCase();
    const role = payload.role === "admin" || payload.role === "viewer" ? payload.role : "member";
    if (!memberEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(memberEmail)) return Response.json({ error: "A valid member email is required" }, { status: 400 });
    try { return Response.json({ member: await inviteWorkspaceMember(email, memberEmail, role) }, { status: 201 }); }
    catch (error) { return failure(error, "Unable to invite member"); }
  }
  const name = payload.name?.trim();
  const repository = payload.repository?.trim();
  const branch = payload.branch?.trim() || "main";
  if (!name || !repository) return Response.json({ error: "Project name and repository are required" }, { status: 400 });
  if (name.length > 80 || repository.length > 160 || branch.length > 120) return Response.json({ error: "Project fields exceed allowed length" }, { status: 400 });
  try {
    return Response.json({ project: await createProject(email, { name, repository, branch }) }, { status: 201 });
  } catch (error) { return failure(error, "Unable to create project"); }
}
