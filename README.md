# genia-travel-bot

Automatisation : événements majeurs → lien de voyage Expedia affilié et traçable → publication Facebook / Instagram, avec mesure de conversion en retour.

Plan de projet complet : [`docs/PLAN.md`](docs/PLAN.md).

## État d'avancement

- ✅ **Phase 0 — Fondations** : monorepo npm workspaces, `docker-compose` (Postgres + Redis), migrations, config, logger.
- ✅ **Phase 1 — Link builder + Redirector** : constructeur d'URL Expedia affiliée, subid, service de redirection `/go/{hash}` avec log des clics.
- 🟡 **Phase 2 — Scanner + scoring** : source Ticketmaster, filtre géo, déduplication, scoring 0–100, insertion en `new`. Code complet et testé hors-ligne ; **jalon non validé** — il exige une clé API Ticketmaster (voir ci-dessous).
- ✅ **Phase 3 — Générateur de créa** : texte d'annonce + visuel PNG, mention « Publicité » intégrée au gabarit.
- ⬜ Phase 4 — Publisher (Facebook / Instagram)
- ⬜ Phase 5 — Analytics + boucle
- ⬜ Phase 6 — Automatisation

## Démarrage local

```bash
cp .env.example .env        # renseigner au minimum EXPEDIA_AFFILIATE_ID
docker compose up -d        # Postgres + Redis
npm install
npm run migrate             # applique migrations/*.sql
npm run dev                 # démarre le redirector, se connecte à la base
```

`npm run dev` doit logger `connected to database` puis `redirector listening` — c'est le jalon de la Phase 0.

### Vérifier le jalon de la Phase 1

```bash
npm run seed:test-offer
```

Le script insère un événement de test et construit **une offre par ville d'origine** via `buildOffersForEvent()` — soit deux offres (YUL et YYZ), chacune avec son propre `short_hash` et son propre `subid`. Il logue les URL à ouvrir, du type `http://localhost:3000/go/<hash>`. Ouvre-les : tu dois atterrir sur une URL Expedia contenant `EXPEDIA_AFFILIATE_ID` et le subid, et une ligne doit apparaître dans la table `clicks` pour chacune.

```bash
psql "$DATABASE_URL" -c "select offer_id, ip_hash, clicked_at from clicks order by clicked_at desc limit 1;"
```

### Phase 2 — Scanner (jalon en attente d'une clé API)

```bash
# 1. clé gratuite sur https://developer.ticketmaster.com/
echo 'TICKETMASTER_API_KEY=ta_cle' >> .env
npm run scan
```

`npm run scan` fait : `fetch` Ticketmaster → filtre `GEO_SCOPE` (CA/US/MX) → déduplication → scoring → insertion en `status='new'`, puis affiche le top 20 par score. Le jalon du plan (« 50 événements réels en base, sans doublons, triés par score ») se valide en lisant ce classement.

Le scoring est sur 100, décomposé en quatre signaux auditables (`packages/scanner/src/scoring.ts`) :

| Signal | Poids | Logique |
|---|---|---|
| Catégorie | 0–30 | festival > sport > concert > congrès |
| Capacité | 0–25 | log-échelle ; 12 par défaut si inconnue (Ticketmaster ne la fournit pas) |
| Délai | 0–25 | maximum dans la fenêtre J-21..J-56, décroît des deux côtés |
| Destination | 0–20 | **0 si l'événement est dans une ville d'origine** (YUL/YYZ) — personne n'y réserve d'hôtel |

### Phase 3 — Créas

```bash
npm run creative:preview        # écrit packages/publisher/creative-preview/index.html
```

Génère 10 créas (visuel PNG + texte) et une planche-contact HTML pour la revue manuelle du jalon. Utilise les offres réelles en base dès qu'il y en a assez, sinon des fixtures.

**Choix : gabarits, pas de LLM.** Le jalon exige qu'aucune créa ne soit « embarrassante ou fausse ». Un gabarit n'interpole que des champs vérifiés en base (titre, ville, dates) et ne peut donc rien inventer — pas de prix, pas de rabais, pas de disponibilité. Un LLM pourrait halluciner exactement ces faits-là. L'interface reste ouverte si tu veux brancher un générateur LLM plus tard.

Deux règles encodées dans le générateur :

- **La mention « Publicité » est produite par le gabarit**, jamais ajoutée à la main — dans le texte *et* dans le visuel. Des tests vérifient sa présence sur les 2 plateformes × 2 langues.
- **Instagram ne rend pas les liens cliquables dans les légendes.** Le texte IG ne contient donc aucune URL (ce serait du bruit mort) et renvoie vers le lien en bio ; l'URL est retournée à part pour la bio/story.

La langue suit la **ville de départ** : YUL → français, YYZ → anglais.

### Tests

```bash
npm run test --workspaces
```

55 tests, dont : l'ID affilié et le subid présents dans l'URL finale (piège #4), et la déduplication résistante aux variantes de titre (piège #2).

## Décisions (plan, section 7)

Les 5 décisions sont figées et reflétées dans `.env.example` / `packages/core/src/config.ts` :

1. **Villes d'origine** — YUL + YYZ (Montréal + Toronto). → `ORIGIN_AIRPORTS`. Un événement approuvé produit **une offre par origine**, chacune avec son subid, pour que les conversions restent attribuables à la ville de départ.
2. **Périmètre géographique** — Amérique du Nord seulement pour le MVP. → `GEO_SCOPE`
3. **Validation humaine** — approbation manuelle activée (recommandation du plan pour les 3 premières semaines). → `HUMAN_APPROVAL_REQUIRED`
4. **Fenêtre de publication** — J-21 à J-56 avant l'événement (recommandation du plan). → `PUBLISH_WINDOW_MIN_DAYS` / `MAX_DAYS`
5. **Sources d'événements** — Ticketmaster Discovery API comme source unique de départ pour la Phase 2. → `EVENT_SOURCE_PRIMARY`, `TICKETMASTER_API_KEY` (clé à obtenir avant d'attaquer la Phase 2)

Détail et justification de chaque choix : [`docs/PLAN.md`](docs/PLAN.md), section 7.

## Variables d'environnement

Voir [`.env.example`](.env.example). `EXPEDIA_AFFILIATE_ID` et `DATABASE_URL` sont requis au démarrage (`packages/core/src/config.ts` lève une erreur explicite s'ils manquent).

## Architecture

Cinq étages, communiquant uniquement via la base de données (aucun appel direct entre modules) :

```
[1] SCANNER → events → [2] LINK BUILDER → offers → [3] REDIRECTOR → clicks
                                                          ↓
[5] ANALYTICS ← conversions ← [4] PUBLISHER ← posts ← [3]
     ↺ réinjecte dans [1]
```

Détails complets dans [`docs/PLAN.md`](docs/PLAN.md).
