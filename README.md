<!-- style_gate: pass -->

<div align="center">

# ai-status

**L’état des fournisseurs IA, sur une seule page.**

23 fournisseurs · Français / English · GitHub Pages

[Ouvrir le tableau de bord](https://status.librenet.fr/) · [Signaler un problème](https://github.com/ayoahha/ai-status/issues)

[![Tests, collecte et publication](https://github.com/ayoahha/ai-status/actions/workflows/collect.yml/badge.svg?branch=main)](https://github.com/ayoahha/ai-status/actions/workflows/collect.yml)

</div>

---

## Ce que propose la page

- Les états, incidents et maintenances des fournisseurs IA et clouds d’inférence
- Une recherche, des filtres par état et un tri par nom ou gravité
- Le détail des modèles et services suivis, avec les sources et l’heure de collecte
- Une interface bilingue, utilisable au clavier, avec thème clair ou sombre

## Comprendre les statuts

La page regroupe les informations publiées par les sources officielles. Une source illisible apparaît **« Non vérifié »**. Chaque carte précise le périmètre couvert ; « Opérationnel » ne garantit pas la disponibilité de tous les services d’un fournisseur.

Quelques périmètres particuliers :

| Fournisseur | Ce qui est suivi |
|---|---|
| Perplexity | Website, App et Computer ; API non couverte |
| OpenRouter | API Gateway et Web & Application Services |
| Mistral | Génération réelle sur **Ministral 3 3B** ; autres modèles et services non testés |
| Replicate | Statut global publié par Cloudflare ; sans détail API/GPU |
| GLM / Zhipu et Baidu ERNIE | Sources non vérifiées, avec la raison affichée sur la carte |

La collecte est programmée toutes les 30 minutes. GitHub Actions peut la retarder : l’heure affichée fait foi, et une alerte apparaît lorsque les données ont plus de deux heures. Le bouton **Rafraîchir** recharge les dernières données publiées.

## Lancer en local

Prérequis : **Node.js 22 ou plus** et **Python 3** pour le serveur local.

```sh
npm ci
npm run collect
npm run serve
```

Ouvrir ensuite [localhost:8080](http://localhost:8080).

La sonde Mistral utilise la variable d’environnement `MISTRAL_API_KEY`. Sans clé, les autres collectes fonctionnent et Mistral reste non vérifié. Ne pas enregistrer la clé dans le dépôt. Chaque collecte avec une clé effectue un appel facturable à `ministral-3b-2512`, limité à 8 tokens de sortie, sans nouvelle tentative automatique. Voir les [tarifs Mistral](https://mistral.ai/pricing/api/).

Pour lancer les tests, sans appel aux fournisseurs :

```sh
npx playwright install chromium
npm test
```

## Publier avec GitHub Pages

Dans **Settings → Pages**, choisir **GitHub Actions** comme source. Ajouter `MISTRAL_API_KEY` aux secrets Actions du dépôt pour activer la sonde Mistral ; la clé reste dans la collecte et n’est jamais envoyée à la page publique.

Les PR lancent les tests. Sur `main`, le workflow teste, collecte et publie la page avec ses données. Un lancement manuel sur une autre branche permet de vérifier la collecte sans déployer. Le fichier généré `public/data/status.json` n’est pas versionné.

## Contribuer

Les fournisseurs et leurs périmètres sont déclarés dans [providers.json](providers.json), les lecteurs dans [adapters/](adapters/) et les tests dans [test/](test/). Toute nouvelle source doit être attribuable et testée ; une lecture incomplète ne doit jamais produire un faux statut opérationnel.

---

<div align="center">

Projet indépendant · [Tableau de bord](https://status.librenet.fr/) · [Signaler un problème](https://github.com/ayoahha/ai-status/issues)

</div>
