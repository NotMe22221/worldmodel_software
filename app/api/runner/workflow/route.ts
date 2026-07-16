import { getSaasSnapshot } from "@/db/saas";
import { requestIdentity } from "@/server/request-identity";
import { generateRunnerWorkflow } from "@/worldmodel/runner-workflow.mjs";

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project")?.trim() || "";
  try {
    const snapshot = await getSaasSnapshot(email);
    const project = snapshot.projects.find(
      (candidate) => String(candidate.id) === projectId,
    );
    if (!project) throw new Error("Project not found in this workspace");
    if (!project.repository_verified)
      throw new Error(
        "Import the repository through GitHub before downloading a runner workflow",
      );
    const workflow = generateRunnerWorkflow({
      projectId,
      apiOrigin: url.origin,
    });
    return new Response(workflow, {
      headers: {
        "content-type": "application/yaml; charset=utf-8",
        "content-disposition": `attachment; filename="worldmodel-${projectId}.yml"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to generate workflow";
    const status = message.includes("not found")
      ? 404
      : message.includes("through GitHub")
        ? 409
        : 400;
    return Response.json({ error: message }, { status });
  }
}
