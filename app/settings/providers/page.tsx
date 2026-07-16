"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import "../../auth.css";
import "./provider.css";

type Configuration = {
  composio?: { configured?: boolean; githubConfigured?: boolean; fixture?: boolean };
  github?: { configured?: boolean };
};

export default function ProviderSettingsPage() {
  const [configuration, setConfiguration] = useState<Configuration>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/provider-settings", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ configuration?: Configuration }>)
      .then((result) => {
        setConfiguration(result.configuration || {});
        setStatus(result.configuration?.composio?.configured ? "Composio GitHub OAuth is ready for every workspace." : "Composio setup is incomplete.");
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
    const response = await fetch("/api/provider-settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(formElement))),
    });
    const result = await response.json() as { error?: string; configuration?: Configuration };
    if (!response.ok) setError(result.error || "Unable to save provider settings");
    else {
      setConfiguration(result.configuration || {});
      setStatus("Credentials encrypted. Customers can now connect GitHub with one click.");
      formElement.reset();
    }
    setWorking(false);
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
        <small>Create a Composio-managed GitHub auth config and use a least-privilege project API key. The callback is generated from the current deployment origin.</small>
      </div>
      <form onSubmit={submit}>
        <label>Composio project API key<input name="composioApiKey" type="password" autoComplete="off" placeholder={configuration.composio?.configured ? "Configured — enter only to rotate" : "ak_…"} required={!configuration.composio?.configured} /></label>
        <label>GitHub auth config ID<input name="composioGithubAuthConfigId" placeholder={configuration.composio?.configured ? "Configured — enter only to change" : "ac_…"} required={!configuration.composio?.configured} /></label>
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
        <button disabled={working}>{working ? "Encrypting and saving…" : "Enable Composio GitHub →"}</button>
      </form>
    </section>
  </main>;
}
