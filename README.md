# ai-status

Statut opérationnel des principaux fournisseurs de modèles IA, affiché de façon
lisible et honnête sur une page statique déployable sur GitHub Pages.

## Architecture

```
providers.json          liste déclarative des fournisseurs (id, nom, URL de statut, source)
collect.mjs             collecteur : lance un adaptateur par fournisseur
adapters/*.mjs         un adaptateur par famille de source (échec isolé)
lib/normalize.mjs       normalisation vers l'enum du site
lib/http.mjs            fetch avec timeout + UA navigateur
public/                 site statique (index.html, style.css, app.js, data/status.json)
public/data/status.json généré par la collecte, versionné avec le dépôt
.github/workflows/      collect.yml (périodique + manuel), pages.yml (GitHub Pages)
```

Flux : GitHub Actions exécute `node collect.mjs` (toutes les 30 min et sur
`workflow_dispatch`), qui écrit `public/data/status.json` (commit + push si modifié).
Le front ne lit que ce fichier ; aucune API propriétaire côté client.

## Fournisseurs et méthode de collecte

| Fournisseur | Source officielle | Méthode |
|---|---|---|
| Anthropic | https://status.claude.com | API publique Statuspage v2 (`/api/v2/status.json`) |
| OpenAI | https://status.openai.com | API publique Statuspage v2 |
| xAI | https://status.x.ai | Page bloquée par Cloudflare (HTTP 403) → affiché « Non vérifié », sans contourner |
| Google / Gemini | https://status.cloud.google.com | Scraping HTML isolé (icônes `psd-status-icon` par produit) |
| Cursor | https://status.cursor.com | API publique Statuspage v2 |
| Qwen / Alibaba Cloud | https://status.alibabacloud.com | API JSON publique `/api/status/listHistoryEvent` |
| DeepSeek | https://status.deepseek.com | SPA (données côté client) → « Non vérifié » sans API publique |
| Kimi / Moonshot | https://status.moonshot.cn | API publique Statuspage v2 |
| GLM / Zhipu | https://status.zhipuai.cn | Source inatteignable (timeout depuis la CI locale) → « Non vérifié » |
| MiniMax | https://status.minimaxi.com | API publique Statuspage v2 |
| Groq | https://groqstatus.com (redirige depuis status.groq.com) | API publique Statuspage v2 |
| Replicate | https://replicatestatus.com (redirige depuis status.replicate.com) | API publique Statuspage v2 |
| Cohere | https://status.cohere.com | API publique Statuspage v2 |
| Fireworks AI | https://status.fireworks.ai | API publique Statuspage v2 |

### Évalués mais non intégrés (pas de source publique stable trouvée)

- **AWS Bedrock** — la page statut régionale est une SPA sans flux RSS/API publics documentés.
- **Microsoft Azure AI** — https://status.azure.com : SPA custom, flux RSS inexistants.
- **Mistral, Perplexity, Together AI, Hugging Face** — pages hébergées par Instatus :
  données chargées côté client, aucune API/flux public documenté.
- **Baidu ERNIE, Tencent Hunyuan, ByteDance / Doubao** — pas de page de statut
  publique fiable trouvée depuis cette machine.

Règle : un fournisseur n'est intégré que s'il existe une source publique, stable et
attribuable. Sinon il est signalé « Non vérifié » avec la date de dernière tentative
et le lien de la source connue — jamais « Opérationnel ».

## Schéma de `public/data/status.json`

```jsonc
{
  "generatedAt": "2026-09-03T15:40:00Z",
  "providers": [{
    "id": "anthropic",
    "name": "Anthropic",
    "statusUrl": "https://status.claude.com",
    "status": "operationnel",           // operationnel | degradation | incident_majeur | maintenance | indisponible | inconnu
    "rawStatus": "All Systems Operational",   // texte original, si la source le fournit
    "rawIndicator": "none",                    // indicateur brut de la source
    "components": ["API"],           // seuls les composants explicitement fournis par la source
    "incidents": [{ "title": "…", "state": "resolved", "createdAt": "…" }],
    "sourcePublishedAt": "2026-09-03T15:39:13Z", // horodatage source si disponible
    "collectedAt": "2026-09-03T15:40:00Z",
    "collect": { "state": "ok", "error": null }  // "ok" ou "error" + message court, sans secret
  }]
}
```

## Lancer localement

```sh
node collect.mjs                  # génère public/data/status.json
node test/test.mjs                # tests légers (normalisation, adaptateurs en échec, validité JSON)
npx --yes http-server public -p 8080   # puis http://localhost:8080
```

## Workflows

- `.github/workflows/collect.yml` : collecte toutes les 30 min (`cron: '*/30 * * * *'`)
  et exécutable manuellement (bouton *Run workflow*). Commite et pousse le JSON modifié.
- `.github/workflows/pages.yml` : déploie le contenu de `public/` sur GitHub Pages
  (actions officielles `upload-pages-artifact` + `deploy-pages`).

À activer dans Settings → Pages : « Build and deployment → Source: Deploy from branch,
branche `main`, dossier `/public` si on préfère le déploiement sans workflow ;
sinon le workflow `pages.yml` suffit.

## Limites

- Les sources externes sont non fiables : contenu non exécuté, pas de secret ni jeton
  stockés ; tout texte affiché est inséré via `textContent` (pas d'innerHTML).
- Un échec de collecte produit toujours le statut `inconnu` (« Non vérifié »), jamais
  `operationnel` — la distinction « aucun incident déclaré » et « information inconnue »
  est préservée.
- Les CAPTCHA/Cloudflare ne sont jamais contournés ; les pages protégées restent « Non vérifié ».
