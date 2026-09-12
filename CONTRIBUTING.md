<!-- style_gate: pass -->

# Contribuer à AI Status

## Signaler un problème

Ouvrir une [issue](https://github.com/ayoahha/ai-status/issues) avec le fournisseur concerné, le résultat attendu, le résultat affiché et l’heure de collecte. Joindre le lien de la source officielle si possible. Pour un problème d’affichage, préciser le navigateur et la langue utilisée.

Ne joindre aucune clé API, aucun cookie ni jeton de session.

## Préparer une modification

Créer une branche de travail et installer les outils :

```sh
npm ci
npx playwright install chromium
npm test
```

Le collecteur utilise Node.js 22 ou plus. Python 3 sert uniquement au serveur local (`npm run serve`). Les tests ne contactent pas les fournisseurs et n’ont pas besoin de clé Mistral.

## Corriger ou ajouter une source

- Déclarer le fournisseur dans [providers.json](providers.json), avec un identifiant stable et un périmètre explicite en français et en anglais
- Réutiliser un lecteur de [adapters/](adapters/) lorsqu’il couvre le format ; enregistrer tout nouveau lecteur dans [collect.mjs](collect.mjs)
- Conserver une réponse réduite dans [test/fixtures/](test/fixtures/), sans secret, avec son URL et sa date d’observation ; distinguer les scénarios synthétiques
- Vérifier dans [test/](test/) les états et événements concernés, ainsi que les réponses absentes ou incomplètes : une source illisible reste « Non vérifié »
- Mettre à jour le tableau du [README](README.md) si le fournisseur ou son périmètre change

Utiliser les sources officielles et le client HTTP existant. Respecter les limites d’accès et de taille, l’isolation des erreurs et le contrat JSON partagé. Une sonde sur un modèle ne décrit pas la santé de tout le fournisseur.

## Proposer la PR

Relancer `npm test`, puis décrire le problème, la correction et les vérifications effectuées. Pour l’interface, vérifier le français, l’anglais et la navigation au clavier.

Une collecte réelle (`npm run collect`) contacte les sources ; avec `MISTRAL_API_KEY`, elle consomme des tokens. Ne pas versionner `public/data/status.json`. Distinguer les tests simulés d’une collecte réussie : une CI verte ne prouve pas que chaque fournisseur a été lu.

Les PR exécutent les tests. La publication du site se fait depuis `main`.

---

[Retour au README](README.md) · [Licence MIT](LICENSE)
