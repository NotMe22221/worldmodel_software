import { getOperatorSnapshot, updateOperatorSupportCase } from "@/db/operator";
import { requestIdentity } from "@/server/request-identity";

function failure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Operator request failed";
  const status = message.includes("Operator access")
    ? 403
    : message.includes("not found")
      ? 404
      : 400;
  return Response.json(
    { error: message },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

export async function GET(request: Request) {
  const email = await requestIdentity(request);
  if (!email)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  try {
    return Response.json(await getOperatorSnapshot(email), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const email = await requestIdentity(request);
  if (!email)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  let payload: {
    action?: string;
    caseId?: string;
    status?: string;
    note?: string;
  };
  try {
    payload = await request.json();
  } catch {
    return Response.json(
      { error: "A valid JSON request body is required" },
      { status: 400 },
    );
  }
  if (
    payload.action !== "update-case" ||
    !payload.caseId ||
    payload.caseId.length > 100
  )
    return Response.json(
      { error: "Choose a valid operator action" },
      { status: 400 },
    );
  try {
    return Response.json({
      supportCase: await updateOperatorSupportCase(
        email,
        payload.caseId,
        payload.status || "",
        payload.note || "",
      ),
    });
  } catch (error) {
    return failure(error);
  }
}
