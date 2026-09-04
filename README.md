---
style_gate: pass
---

# ai-status

Statut opérationnel des principaux fournisseurs de modèles IA, affiché de façon lisible et honnête sur une page statique GitHub Pages.

## Architecture

```
providers.json          liste déclarative des fournisseurs (id, nom, groupe, périmètre, source, motif « modèle »)
collect.mjs             CLI : lit providers.json, table famille de source → adaptateur, écrit le JSON
lib/collect.mjs         runner (exécute chaque adaptateur, isole et classe les échecs) et assemblage
                        du contrat v2 (pur, testé) : statut, résumé, raisons et erreurs FR / EN
lib/normalize.mjs       enum des états, tables de correspondance, worstOf, classifyKind
lib/errors.mjs          erreurs typées (code http | timeout | network | schema | scope | browser…)
lib/http.mjs            client `get(url, {as, accept, timeoutMs})` : timeout, UA navigateur, HttpError hors 2xx
adapters/unavailable.mjs source connue mais injoignable ou inexistante : aucune requête, jamais vert
adapters/statuspage.mjs Atlassian Statuspage (summary.json)
adapters/google.mjs     Google Cloud (products.json + incidents.json)
adapters/flashcat.mjs   pages Flashcat (DeepSeek)
adapters/alibaba.mjs    Alibaba Cloud (listHistoryEvent)
adapters/browser.mjs    Playwright + Chromium, xAI seulement
adapters/instatus.mjs   Instatus (Perplexity) : summary.json + v2/components.json
adapters/betterstack.mjs Better Stack (Together AI) : index.json
adapters/checkly.mjs    Checkly (Mistral) : endpoints JSON appelés par la page
adapters/onlineornot.mjs OnlineOrNot (OpenRouter) : données SSR turbo-stream embarquées dans la page
adapters/aws.mjs        AWS Health Dashboard (Bedrock) : currentevents + services.json
adapters/azure.mjs      Azure status : tableau HTML des services, lignes IA
adapters/tencent.mjs    Tencent Cloud status (Hunyuan) : API JSON de la page
adapters/volcengine.mjs Volcengine status (Ark / Doubao) : flux RSS par région
public/                 site statique (index.html, style.css, app.js), sans dépendance ; interface FR / EN
public/data/status.json généré par la collecte, jamais versionné (dans .gitignore)
test/                   tests sans réseau, fixtures réelles dans test/fixtures/
.github/workflows/      collect.yml : tests, collecte, publication GitHub Pages
```

Ajouter un fournisseur Statuspage : une entrée dans `providers.json` (`kind: statuspage`, `url`, `group` parmi `us`, `eu`, `cn`, `cloud`, `scope` et `scopeEn`, éventuellement `modelPattern`) et une ligne dans la table ci-dessous. Toute autre famille de source demande un adaptateur avec sa fixture réelle et ses tests.

Forme d'un adaptateur (`adapters/<famille>.mjs`) : une fonction `collect(provider, get)` qui lit la source avec le client `get` (`as: json | text | bytes`) et rend un résultat de lecture `{ indicator, rawStatus, components, incidents, maintenances, note, noteEn }` ; `indicator` est l'état de page normalisé publié par la source (ou la règle propre de l'adaptateur), `null` si elle n'en publie pas, et le statut fournisseur est dérivé par le contrat : pire de l'indicateur, des composants et d'une maintenance en cours. Elle lève `fail('schema', détail)` sur structure inattendue et `fail('scope', détail)` quand le périmètre demandé est absent ; réseau, HTTP et timeout remontent d'eux-mêmes. Le runner (`lib/collect.mjs`) capture tout échec, le classe et rend le fournisseur « Non vérifié » avec un texte FR / EN : un adaptateur ne fabrique jamais d'état « inconnu » lui-même. Une `note` non fatale (services absents, région illisible) accompagne une lecture réussie. Le module exporte aussi `METHOD = { fr, en }`, le libellé « Lu via … » que la page affiche, transporté dans le contrat (`collect.methodLabel`, `collect.methodLabelEn`). Enregistrer le module dans la table `ADAPTERS` de `collect.mjs`.

Flux : GitHub Actions exécute `node collect.mjs` à `:07` et `:37` de chaque heure (et sur push `main` ou lancement manuel), vérifie le JSON produit, puis publie `public/` comme artefact GitHub Pages dans le même workflow. Ce décalage réduit le risque de retard des tâches GitHub planifiées sans garantir leur ponctualité. Rien n'est commité par la CI : la page et ses données partent ensemble, atomiquement. Le front ne lit que `data/status.json` ; aucune API propriétaire côté client.

## Fournisseurs et méthode de collecte

| Fournisseur | Source officielle | Méthode |
|---|---|---|
| Anthropic | https://status.claude.com | API publique Statuspage v2 (`/api/v2/summary.json` : indicateur, composants, incidents non résolus, maintenances) |
| OpenAI | https://status.openai.com | API publique Statuspage v2 |
| xAI | https://status.x.ai | Navigateur headless (Playwright + Chromium) : la page répond 403 à tout client non navigateur, y compris `/api/v2/*`, `/feed` et `/rss` ; le défi Cloudflare automatique est attendu et `navigator.webdriver` est masqué. Un CAPTCHA interactif n'est jamais contourné. Une pilule d'état inconnue rend le fournisseur « Non vérifié » |
| Google Cloud (Vertex AI / Gemini) | https://status.cloud.google.com | Flux JSON officiels `products.json` + `incidents.json`, restreints aux produits dont le titre commence par « Vertex » ou « Gemini », toutes régions. « Opérationnel » signifie « aucun incident déclaré sur ce périmètre » |
| Cursor | https://status.cursor.com | API publique Statuspage v2 |
| Alibaba Cloud | https://status.alibabacloud.com | API JSON publique `/api/status/listHistoryEvent` : statut cloud global (toutes régions et produits), pas Qwen ni Model Studio en particulier ; seuls les événements en cours sont exposés. Aucun composant : la carte affiche « Statut global » |
| DeepSeek | https://status.deepseek.com | API JSON de la page Flashcat (`/api/status-page/<pageId>/summary/active`) : composants et changements actifs, sans navigateur. Un payload sans composants n'est jamais traité comme sain |
| Kimi / Moonshot | https://status.moonshot.cn | API publique Statuspage v2 |
| GLM / Zhipu | https://status.zhipuai.cn | Aucune requête : le domaine résout mais ne répond ni en 80 ni en 443 depuis l'extérieur de la Chine, y compris depuis les runners GitHub. Affiché « Non vérifié » avec cette explication |
| MiniMax | https://status.minimaxi.com | API publique Statuspage v2 |
| Perplexity | https://status.perplexity.com | Instatus, API publique documentée (`/summary.json` : état de page, incidents et maintenances actives ; `/v2/components.json` : composants). Périmètre : site, API, Computer |
| Mistral AI | https://status.mistral.ai | Page Checkly (Nuxt). Pas de flux ni d'API documentés par Checkly, mais la page appelle trois endpoints JSON publics sans jeton, observés dans ses requêtes : `/api/status-page/mistral-ai/uptime` (groupes et services), `/unresolved-incidents`, `/maintenance-windows`. Sévérités MINOR/MEDIUM → dégradation, MAJOR → incident majeur, CRITICAL → indisponible ; un incident ouvert sans liste de services lisible rend tous les services « Non vérifié » |
| Tencent Hunyuan | https://status.cloud.tencent.com | API JSON de la page (`/v1/api/status/DescribeProductEventForRegionInPeriod?RegionId=non-regional`), non documentée mais publique et sans jeton : `CurrentStatus` par produit (NORMAL, NOTIFY « 提示 », ABNORMAL « 异常 »). Périmètre : produits Hunyuan (LLM, image, vidéo, 3D, agents), non régionaux. Noms de produits en chinois, conservés tels quels. Hypothèse : NOTIFY et ABNORMAL sont tous deux affichés « Dégradation » avec le titre de l'événement ; aucun cas réel observé |
| ByteDance / Doubao (Volcengine Ark) | https://status.volcengine.com | L'API BFF de la page (`/api/v1/shd/prefetch-shd`) répond 401 hors navigateur : contrôle d'accès, non contourné. La page lie un flux RSS officiel par produit et par région (`/rss/zh/<région>/ModelArk`), lu pour cn-beijing, cn-shanghai, cn-guangzhou et ap-southeast-1. Le flux liste l'historique ; un événement terminé porte « (已恢复) » dans son titre, un événement en cours ne le porte pas. Une région inconnue renvoie un canal sans nom de région : composant « Non vérifié » |
| Baidu ERNIE | https://cloud.baidu.com/product-s/qianfan_home | Aucune page de statut publique trouvée pour Baidu AI Cloud ni Qianfan (recherche du 2026-09-04 : cloud.baidu.com, intl.cloud.baidu.com, sous-domaines `status.*`). Aucune requête : affiché « Non vérifié » |
| Groq | https://groqstatus.com (redirige depuis status.groq.com) | API publique Statuspage v2 |
| Replicate | https://replicatestatus.com (redirige depuis status.replicate.com) | API publique Statuspage v2 |
| Cohere | https://status.cohere.com | API publique Statuspage v2 |
| Fireworks AI | https://status.fireworks.ai | API publique Statuspage v2 |
| Together AI | https://status.together.ai | Better Stack, endpoint public documenté `/index.json` (JSON:API) : `aggregate_state`, ressources `status_page_resource` (operational, degraded, downtime, maintenance, not_monitored → « Non vérifié »), rapports `status_report` ouverts (`ends_at` null) |
| OpenRouter | https://status.openrouter.ai | OnlineOrNot. Pas d'API sans clé ; le flux `/incidents.rss` ne donne pas l'état des composants. La page est rendue côté serveur par React Router et embarque ses données de chargement (composants avec état, incidents avec `ended`) dans des balises `<script>` au format turbo-stream, décodé sans DOM ni navigateur. Périmètre : la passerelle (site, API chat/models/generation, authentification), pas les fournisseurs amont |
| AWS Bedrock | https://health.aws.amazon.com/health/status | La page charge deux flux JSON publics sans jeton, observés dans ses requêtes : `health.aws.amazon.com/public/currentevents` (événements en cours, encodé UTF-16 avec BOM) et `servicedata-eu-west-1-prod.s3.amazonaws.com/services.json` (catalogue service × région). Codes d'état du bundle de la page : 0 resolved, 1 impacted (info), 2 degraded, 3 disrupted. Périmètre : `service_name = Amazon Bedrock`, une entrée par région (AgentCore exclu). Les flux RSS documentés existent mais un par service et par région |
| Microsoft Azure AI | https://azure.status.microsoft/en-us/status (redirection depuis status.azure.com) | Page rendue côté serveur, sans JSON. Le flux RSS documenté (`/status/feed/`) ne liste que les incidents publiés, sans état par service. Lecture du tableau HTML (une ligne par service et par zone, cellules `data-label` : Good, Information, Warning, Critical, Not available) pour onze services IA (Azure OpenAI Service, Foundry Models, Foundry Agent Service, AI Search, Speech, Language, Vision, Document Intelligence, Content Safety, Translator, Machine Learning). Microsoft ne publie sur cette page que les incidents à large impact ; « Good » ne garantit pas l'absence d'incident ciblé |

### Évalués mais non intégrés

- **Baidu ERNIE / Qianfan** : aucune page de statut publique trouvée (voir table). Affiché « Non vérifié ».
- **Hugging Face** : non demandé, non réévalué.

Règle : un fournisseur n'est intégré que s'il existe une source publique, stable et attribuable, lue sans identifiant, jeton, endpoint privé ni contournement de contrôle d'accès. Sinon il est signalé « Non vérifié » avec la raison et le lien de la source connue, jamais « Opérationnel ».

## Schéma de `public/data/status.json`

```jsonc
{
  "schemaVersion": 2,
  "generatedAt": "2026-09-03T15:40:00Z",
  "labels": { "operationnel": "Opérationnel", "…": "…" },   // libellés FR
  "labelsEn": { "operationnel": "Operational", "…": "…" },  // libellés EN, pour le sélecteur de langue
  "summary": {
    "worst": "degradation",            // pire état réel ; « inconnu » n'y entre pas, il a son compteur
    "counts": { "operationnel": 12, "degradation": 1, "inconnu": 1, "…": 0 },
    "activeIncidents": 1,
    "activeMaintenances": 0
  },
  "providers": [{
    "id": "anthropic",
    "name": "Anthropic",
    "group": "us",                     // us | eu | cn | cloud : section d'affichage, libellés dans public/app.js
    "scope": "Claude API, claude.ai, Claude Code",   // ce que la carte mesure réellement
    "scopeEn": "Claude API, claude.ai, Claude Code", // même périmètre en anglais (providers.json)
    "statusUrl": "https://status.claude.com",
    "status": "degradation",           // operationnel | degradation | incident_majeur | maintenance | indisponible | inconnu
    "reason": "1 composant en dégradation",          // phrase générée, jamais du texte brut de la source
    "reasonEn": "1 component degraded",              // même phrase en anglais, même logique
    "sourceText": "Partial System Outage",           // texte original si la source le fournit
    "collectedAt": "2026-09-03T15:40:01Z",
    "collect": { "state": "ok", "method": "statuspage", "error": null, "errorEn": null },   // error : message court, sans secret ; errorEn seulement pour les notes traduites
    "components": [{ "name": "Claude API", "kind": "service", "status": "degradation" }],   // kind ∈ model | service, affichage seulement
    "incidents": [{ "title": "…", "status": "investigating", "impact": "minor", "startedAt": "…", "updatedAt": "…", "url": "…", "components": ["Claude API"] }],   // actifs seulement
    "maintenances": [{ "title": "…", "state": "scheduled", "scheduledFor": "…", "scheduledUntil": "…", "url": "…" }]
  }]
}
```

Règles : un `collect.state = error` force `status = inconnu` ; un composant à l'état illisible interdit `operationnel` au fournisseur sans écraser un état dégradé réel (`worstOf` dans `lib/normalize.mjs`) ; `kind = model` vient du motif `modelPattern` déclaré par fournisseur dans `providers.json`, sinon `service`.

## Lancer localement

```sh
npm ci && npx playwright install chromium   # une fois (Chromium ne sert qu'à xAI)
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

Concurrence : un seul run à la fois par ref (`concurrency.group = collect-<ref>`), mis en file d'attente et jamais annulé, pour ne pas interrompre un déploiement Pages en cours. Un run dure moins d'une minute ; les lancements à `:07` et `:37` ne créent pas de file. Le cron GitHub peut tout de même partir avec plusieurs minutes de retard ou être abandonné, et le CDN Pages peut brièvement conserver une ancienne publication : la fraîcheur affichée tolère ces délais, l'alerte « données obsolètes » ne se déclenche qu'après deux heures.

## Page

- Langue : sélecteur FR / EN en haut de page (boutons à état pressé, utilisables au clavier, annoncés « Français » / « Anglais »). Le français est la langue par défaut ; le changement est instantané, côté client, sans requête, et conserve filtres, recherche, tri et cartes ouvertes ; le choix est mémorisé dans `localStorage`. Toute l'interface est traduite (titre, `lang` du document, bandeau, compteurs, fraîcheur, erreurs, recherche, groupes, cartes, pied de page, textes accessibles). Les raisons et périmètres viennent du collecteur dans les deux langues (`reason` / `reasonEn`, `scope` / `scopeEn`). Les noms de fournisseurs, titres d'incidents, noms de composants et textes bruts des sources ne sont jamais traduits ; les notes techniques de collecte restent en français, marquées `lang="fr"` en mode anglais.
- Bandeau : pire état réel parmi les fournisseurs, nombre de sources non vérifiées, horodatage avec fuseau et âge relatif rafraîchi chaque minute. Les données sont rechargées toutes les 30 minutes, au retour dans un onglet ancien, au retour en ligne ou avec le bouton « Rafraîchir ». Un échec conserve les dernières données valides et affiche une alerte. Les compteurs par état filtrent les cartes.
- « En cours » : fournisseurs dans un état réel (dégradation, incident, indisponibilité, maintenance) avec leurs incidents et maintenances actives ; absent quand tout est vert. Une source non lue n'y figure pas : elle a son compteur et sa carte grise.
- Quatre sections fixes : Fournisseurs · USA, Fournisseurs · Europe, Fournisseurs · Chine, Clouds d'inférence et API. Sous-titre « N fournisseurs · M en alerte · K non vérifiés ». Section vide masquée après filtre ou recherche ; la section Europe affiche un message si elle se vide.
- Ligne fermée : icône d'état, nom, périmètre, nombre de composants (ou « Statut global » quand la source ne publie aucun composant, comme Alibaba Cloud), libellé d'état ; raison seulement hors « opérationnel ». Aucune ligne n'est ouverte d'office : « En cours » porte l'urgence.
- Ligne dépliée : erreur de collecte éventuelle, incidents, maintenances, modèles et services avec leur état, méthode de lecture (libellé fourni par l'adaptateur, dans les deux langues), fraîcheur et lien vers la page officielle. Rien n'est accessible uniquement au survol.
- Chaque état a une forme d'icône distincte et un libellé : la couleur n'est jamais le seul signal. Thème clair par défaut (papier chaud, encre, accent ocre), sombre si le système le demande ; contrastes ≥ 4,5:1 (texte) et ≥ 3:1 (bords de contrôles, icônes) mesurés dans les deux thèmes.
- Polices auto-hébergées dans `public/fonts/` (Fraunces pour la phrase d'état, IBM Plex Sans pour le corps, IBM Plex Mono pour horodatages et compteurs ; sous-ensemble latin, licences OFL jointes). Aucune requête vers un service tiers. Aucune animation : le dépliage et les filtres sont des actions répétées.
- Données de plus de deux heures : bandeau d'alerte.

## Limites

- Les sources externes sont non fiables : contenu jamais exécuté, aucun secret ni jeton stocké ; tout texte affiché est inséré via `textContent`, pas `innerHTML`.
- Un échec de collecte produit toujours le statut `inconnu` (« Non vérifié »), jamais `operationnel` : la distinction « aucun incident déclaré » et « information inconnue » est préservée.
- Un CAPTCHA ou défi Cloudflare interactif n'est jamais contourné ; seul le défi automatique (JavaScript) est attendu, pour xAI.
- L'état par composant reflète ce que la source publie. Statuspage masque les composants « only_show_if_degraded » tant qu'ils sont sains ; Google, Alibaba et Volcengine n'exposent pas d'état par produit hors incident (« opérationnel » = aucun incident déclaré) ; DeepSeek, Mistral, Tencent et Volcengine n'ont jamais été observés en incident, le mapping de leurs événements reste à confirmer sur un cas réel.
- Les endpoints JSON non documentés (Checkly, Tencent, AWS) et les données embarquées (OnlineOrNot, tableau Azure) peuvent changer sans préavis : toute structure inattendue rend le fournisseur « Non vérifié », jamais « Opérationnel ». Les fixtures de `test/fixtures/` figent la structure observée le 2026-09-04.
- Le tableau Azure fait environ 7 Mo par collecte ; Microsoft n'y publie que les incidents à large impact.
- Le type « modèle » ou « service » d'un composant est un motif déclaré par fournisseur, pour le regroupement à l'affichage seulement ; il n'influence aucun état.
