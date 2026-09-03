# ai-status

Statut opérationnel des principaux fournisseurs de modèles IA, affiché de façon lisible et honnête sur une page statique GitHub Pages.

## Architecture

```
providers.json          liste déclarative des fournisseurs (id, nom, URL de statut, source)
collect.mjs             collecteur : lance un adaptateur par fournisseur
adapters/*.mjs          un adaptateur par famille de source (échec isolé)
lib/normalize.mjs       normalisation vers l'enum du site
lib/http.mjs            fetch avec timeout + UA navigateur
public/                 site statique (index.html, style.css, app.js)
public/data/status.json généré par la collecte, jamais versionné (dans .gitignore)
test/                   tests sans réseau, fixtures réelles dans test/fixtures/
.github/workflows/      collect.yml : tests, collecte, publication GitHub Pages
```

Flux : GitHub Actions exécute `node collect.mjs` toutes les 30 minutes (et sur push `main` ou lancement manuel), vérifie le JSON produit, puis publie `public/` comme artefact GitHub Pages dans le même workflow. Rien n'est commité par la CI : la page et ses données partent ensemble, atomiquement. Le front ne lit que `data/status.json` ; aucune API propriétaire côté client.

## Fournisseurs et méthode de collecte

| Fournisseur | Source officielle | Méthode |
|---|---|---|
| Anthropic | https://status.claude.com | API publique Statuspage v2 (`/api/v2/summary.json` : indicateur, composants, incidents non résolus, maintenances) |
| OpenAI | https://status.openai.com | API publique Statuspage v2 |
| xAI | https://status.x.ai | Navigateur headless (Playwright + Chromium) : la page répond 403 à tout client non navigateur, y compris `/api/v2/*`, `/feed` et `/rss` ; le défi Cloudflare automatique est attendu et `navigator.webdriver` est masqué. Un CAPTCHA interactif n'est jamais contourné. Une pilule d'état inconnue rend le fournisseur « Non vérifié » |
| Google Cloud (Vertex AI / Gemini) | https://status.cloud.google.com | Flux JSON officiels `products.json` + `incidents.json`, restreints aux produits dont le titre commence par « Vertex » ou « Gemini », toutes régions. « Opérationnel » signifie « aucun incident déclaré sur ce périmètre » |
| Cursor | https://status.cursor.com | API publique Statuspage v2 |
| Alibaba Cloud (statut global) | https://status.alibabacloud.com | API JSON publique `/api/status/listHistoryEvent` : statut cloud global, pas Qwen ni Model Studio en particulier ; seuls les événements en cours sont exposés |
| DeepSeek | https://status.deepseek.com | API JSON de la page Flashcat (`/api/status-page/<pageId>/summary/active`) : composants et changements actifs, sans navigateur. Un payload sans composants n'est jamais traité comme sain |
| Kimi / Moonshot | https://status.moonshot.cn | API publique Statuspage v2 |
| GLM / Zhipu | https://status.zhipuai.cn | Aucune requête : le domaine résout mais ne répond ni en 80 ni en 443 depuis l'extérieur de la Chine, y compris depuis les runners GitHub. Affiché « Non vérifié » avec cette explication |
| MiniMax | https://status.minimaxi.com | API publique Statuspage v2 |
| Groq | https://groqstatus.com (redirige depuis status.groq.com) | API publique Statuspage v2 |
| Replicate | https://replicatestatus.com (redirige depuis status.replicate.com) | API publique Statuspage v2 |
| Cohere | https://status.cohere.com | API publique Statuspage v2 |
| Fireworks AI | https://status.fireworks.ai | API publique Statuspage v2 |

### Évalués mais non intégrés (pas de source publique stable trouvée)

- **AWS Bedrock** : la page statut régionale est une SPA sans flux RSS/API publics documentés.
- **Microsoft Azure AI** (https://status.azure.com) : SPA custom, flux RSS inexistants.
- **Mistral, Perplexity, Together AI, Hugging Face** : pages hébergées par Instatus, données chargées côté client, aucune API/flux public documenté.
- **Baidu ERNIE, Tencent Hunyuan, ByteDance / Doubao** : pas de page de statut publique fiable trouvée.

Règle : un fournisseur n'est intégré que s'il existe une source publique, stable et attribuable. Sinon il est signalé « Non vérifié » avec la raison et le lien de la source connue, jamais « Opérationnel ».

## Schéma de `public/data/status.json`

```jsonc
{
  "schemaVersion": 2,
  "generatedAt": "2026-09-03T15:40:00Z",
  "labels": { "operationnel": "Opérationnel", "…": "…" },   // libellés FR, source unique pour la page
  "summary": {
    "worst": "degradation",            // pire état réel ; « inconnu » n'y entre pas, il a son compteur
    "counts": { "operationnel": 12, "degradation": 1, "inconnu": 1, "…": 0 },
    "activeIncidents": 1,
    "activeMaintenances": 0
  },
  "providers": [{
    "id": "anthropic",
    "name": "Anthropic",
    "scope": "Claude API, claude.ai, Claude Code",   // ce que la carte mesure réellement
    "statusUrl": "https://status.claude.com",
    "status": "degradation",           // operationnel | degradation | incident_majeur | maintenance | indisponible | inconnu
    "reason": "1 composant en dégradation",          // phrase générée, jamais du texte brut de la source
    "sourceText": "Partial System Outage",           // texte original si la source le fournit
    "collectedAt": "2026-09-03T15:40:01Z",
    "collect": { "state": "ok", "method": "statuspage", "error": null },   // error : message court, sans secret
    "components": [{ "name": "Claude API", "kind": "service", "status": "degradation" }],   // kind ∈ model | service, affichage seulement
    "incidents": [{ "title": "…", "status": "investigating", "impact": "minor", "startedAt": "…", "updatedAt": "…", "url": "…", "components": ["Claude API"] }],   // actifs seulement
    "maintenances": [{ "title": "…", "state": "scheduled", "scheduledFor": "…", "scheduledUntil": "…", "url": "…" }]
  }]
}
```

Règles : un `collect.state = error` force `status = inconnu` ; un composant à l'état illisible interdit `operationnel` au fournisseur sans écraser un état dégradé réel (`worstOf` dans `lib/normalize.mjs`) ; `kind = model` vient du motif `modelPattern` déclaré par fournisseur dans `providers.json`, sinon `service`.

## Lancer localement

```sh
npm ci && npx playwright install chromium   # une fois (Chromium sert à xAI et DeepSeek)
node test/test.mjs                          # tests sans réseau
node collect.mjs                            # génère public/data/status.json
npm run serve                               # puis http://localhost:8080
```

## Workflow `.github/workflows/collect.yml`

- `test` : `npm test` sur chaque push `main`, lancement manuel, cron et pull request.
- `collect` (hors pull request) : collecte, vérifie que le JSON est non vide et bien formé, téléverse `public/` comme artefact Pages. Sans JSON valide, le job est rouge et Pages conserve la publication précédente.
- `deploy` : publie l'artefact, uniquement sur `main`.

Réglage requis dans Settings → Pages : « Build and deployment → Source : GitHub Actions ». Le mode « Deploy from branch » servirait un site sans données, puisque `status.json` n'est pas versionné.

Permissions : `contents: read` pour les tests et la collecte (aucun jeton n'est conservé dans le checkout pendant que Chromium charge des pages tierces), `pages: write` et `id-token: write` pour le seul job de déploiement. Les actions sont épinglées par SHA.

## Limites

- Les sources externes sont non fiables : contenu jamais exécuté, aucun secret ni jeton stocké ; tout texte affiché est inséré via `textContent`, pas `innerHTML`.
- Un échec de collecte produit toujours le statut `inconnu` (« Non vérifié »), jamais `operationnel` : la distinction « aucun incident déclaré » et « information inconnue » est préservée.
- Un CAPTCHA ou défi Cloudflare interactif n'est jamais contourné ; seul le défi automatique (JavaScript) est attendu, pour xAI.
- Les listes « composants impactés » reflètent l'état par composant publié par la source ; un fournisseur dont la source ne publie pas cet état affiche une liste vide.
