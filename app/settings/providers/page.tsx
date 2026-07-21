"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import "../../auth.css";
import "./provider.css";

type Configuration = {
  composio?: { configured?: boolean; githubConfigured?: boolean; fixture?: boolean; missing?: string[] };
  github?: { configured?: boolean };
};

type ProviderMode = {
  editable: boolean;
  source: "local_encrypted_store" | "deployment_environment";
};

export default function ProviderSettingsPage() {
  const [configuration, setConfiguration] = useState<Configuration>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [mode, setMode] = useState<ProviderMode | null>(null);
  const missingComposioSettings = configuration.composio?.missing?.length
    ? configuration.composio.missing
    : ["COMPOSIO_API_KEY"];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/provider-settings", { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({})) as { error?: string; configuration?: Configuration; mode?: ProviderMode };
        if (!response.ok) throw new Error(result.error || "Unable to read provider status");
        return result;
      })
      .then((result) => {
        setConfiguration(result.configuration || {});
        setMode(result.mode || { editable: false, source: "deployment_environment" });
        const missing = result.configuration?.composio?.missing || [];
        setStatus(result.configuration?.composio?.configured
          ? "The Composio project key is present. WorldModel resolves or creates the managed GitHub auth config when an owner connects."
          : `Composio setup is incomplete${missing.length ? `: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing` : ""}.`);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Unable to read provider status.");
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setWorking(true);
    setError("");
    try {
      const response = await fetch("/api/provider-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(formElement))),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; configuration?: Configuration };
      if (!response.ok) throw new Error(result.error || "Unable to save provider settings");
      setConfiguration(result.configuration || {});
      setStatus("Credentials encrypted. Customers can now connect GitHub with one click.");
      formElement.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save provider settings");
    } finally {
      setWorking(false);
    }
  }

  return <main className="auth-shell">
    <Link className="auth-brand" href="/dashboard?tab=integrations">← Back to integrations</Link>
    <section className="auth-card wide">
      <span>PLATFORM PROVIDERS</span>
      <h1>Turn on hosted GitHub OAuth</h1>
      <p>Configure Composio once for this WorldModel deployment. Customers only see “Connect GitHub”; project API keys and OAuth credentials never appear in their workspace.</p>
      {status && <div className="auth-status" role="status">{status}</div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      <div className="provider-instructions">
        <b>Primary connection path</b>
        <code>Composio Connect Link → GitHub OAuth → WorldModel callback</code>
        <small>Add one scoped Composio project API key. WorldModel reuses an enabled managed GitHub auth config or creates one automatically. Grant Auth configs read/write, Connected accounts read/write, and Tool execution write; add Proxy execute write when repository archives, signed runner-workflow verification, or approved draft PR publication are enabled.</small>
      </div>
      {mode === null && !error && <div className="provider-loading" role="status">Checking how this deployment manages provider credentials…</div>}
      {mode && !mode.editable && <section className="provider-deployment" aria-labelledby="deployment-provider-title">
        <h2 id="deployment-provider-title">{configuration.composio?.configured ? "GitHub OAuth credentials are present" : "Finish setup in Vercel"}</h2>
        {configuration.composio?.configured
          ? <p>The required values are present in this deployment. Their validity and access scope are checked when an owner starts a connection; rotate them only from the Vercel project environment.</p>
          : <><p>This deployed app intentionally does not accept provider secrets in the browser. A Vercel project administrator must add the variables below, then redeploy.</p>
            <ol>
              {missingComposioSettings.map((name) => <li key={name}>
                <code>{name}</code>
                <small>{name === "COMPOSIO_API_KEY" ? "Least-privilege project API key from Composio." : "The Composio auth config configured for GitHub."}</small>
              </li>)}
            </ol></>}
        <p>For a scoped key, allow Auth configs read/write, Connected accounts read/write, and Tool execution write. Proxy execute write is also required for immutable archive downloads, exact runner-workflow revision verification, and approved draft PR publication.</p>
        <p>Keep “Automatically expose System Environment Variables” enabled so Vercel supplies the callback origin. Set <code>WORLDMODEL_PUBLIC_ORIGIN</code> only to select a different canonical HTTPS domain.</p>
        <p className="provider-safety">Never paste API keys into support messages, source control, or this page.</p>
        <div className="provider-actions">
          <a href="https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions" target="_blank" rel="noreferrer">Composio scoped-key permissions ↗</a>
          <a href="https://vercel.com/docs/projects/environment-variables" target="_blank" rel="noreferrer">Vercel environment variable guide ↗</a>
          <Link href="/dashboard?tab=integrations">Return to integrations →</Link>
        </div>
      </section>}
      {mode?.editable && <form onSubmit={submit} aria-busy={working}>
        <label>Composio project API key<input name="composioApiKey" type="password" autoComplete="off" placeholder={configuration.composio?.configured ? "Configured — enter only to rotate" : "ak_…"} required={!configuration.composio?.configured} /></label>
        <label>GitHub auth config ID (optional override)<input name="composioGithubAuthConfigId" placeholder="Auto-managed when left blank" /></label>
        <label>OpenAI API key (optional)<input name="openaiApiKey" type="password" autoComplete="off" /></label>
        <label>OpenAI model<input name="openaiModel" defaultValue="gpt-5.6" /></label>
        <details>
          <summary>Advanced: custom GitHub App fallback</summary>
          <p>Only repositories that cannot use Composio need this fallback. Complete every field together.</p>
          <label>GitHub App slug<input name="githubAppSlug" placeholder="worldmodel-for-software" /></label>
          <div className="auth-grid"><label>GitHub App ID<input name="githubAppId" inputMode="numeric" /></label><label>OAuth Client ID<input name="githubClientId" /></label></div>
          <label>OAuth Client secret<input name="githubClientSecret" type="password" autoComplete="off" /></label>
          <label>GitHub App private key<textarea name="githubPrivateKey" rows={6} placeholder="-----BEGIN PRIVATE KEY-----" /></label>
        </details>
        <button type="submit" disabled={working}>{working ? "Encrypting and saving…" : "Enable Composio GitHub →"}</button>
      </form>}
    </section>
  </main>;
}
